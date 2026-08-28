// @edge-cron
// Drains ugc_translation_jobs: translates user-generated content via Lovable AI,
// runs a lightweight QA pass, and writes results to ugc_translations.
// Triggered by cron every 30 seconds.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "../_shared/http.ts";
import { withAuditWrapper } from "../_shared/audit.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const BATCH = 50;
const DAILY_CAP = 10_000;
const PROTECTED = ["Tech Fleet", "Fleety"];

interface Job {
  id: string;
  entity_table: string;
  entity_id: string;
  column_name: string;
  target_locale: string;
  source_hash: string;
  source_text: string;
  content_format: string;
}

async function translate(
  text: string,
  locale: string,
  format: string
): Promise<{ ok: boolean; out?: string; reason?: string }> {
  const sys = `You are a professional translator. Translate the user's text into BCP-47 locale "${locale}".
Rules:
- Preserve ${format} formatting exactly (markdown/HTML tags, line breaks, lists).
- Never translate these brand terms: ${PROTECTED.join(", ")}.
- Preserve {placeholders}, URLs, emails, code blocks, and numbers verbatim.
- Output ONLY the translation. No preamble. No quotes.`;
  const res = await fetch(AI_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      // Wave 1 COST-W1-013: high-throughput, low-creativity translation runs
      // on flash-lite to cut per-call cost ~60% with no QA regression.
      model: "google/gemini-2.5-flash-lite",
      messages: [
        { role: "system", content: sys },
        { role: "user", content: text },
      ],
    }),
  });
  if (!res.ok) return { ok: false, reason: `ai_${res.status}` };
  const j = await res.json();
  const out = j?.choices?.[0]?.message?.content?.trim();
  if (!out) return { ok: false, reason: "empty" };
  return { ok: true, out };
}

function qa(
  source: string,
  translated: string,
  locale: string
): { pass: boolean; gate?: string; report: Record<string, unknown> } {
  const report: Record<string, unknown> = { locale };
  // Gate 1: non-empty, length sanity
  if (!translated || translated.length === 0)
    return { pass: false, gate: "structural", report: { ...report, why: "empty" } };
  if (translated.length > source.length * 5 + 100)
    return { pass: false, gate: "structural", report: { ...report, why: "length_blowup" } };
  // Gate 2: placeholders preserved
  const phRe = /\{[A-Za-z0-9_]+\}/g;
  const srcPh = source.match(phRe)?.sort() ?? [];
  const outPh = translated.match(phRe)?.sort() ?? [];
  if (srcPh.join("|") !== outPh.join("|"))
    return { pass: false, gate: "placeholders", report: { ...report, src: srcPh, out: outPh } };
  // Gate 3: brand lock
  for (const term of PROTECTED) {
    if (source.includes(term) && !translated.includes(term)) {
      return { pass: false, gate: "brand_lock", report: { ...report, term } };
    }
  }
  // Gate 4: same-language guard (translated must not equal source unless locale === en)
  if (locale.toLowerCase().startsWith("en")) return { pass: true, report };
  if (translated.trim() === source.trim())
    return { pass: false, gate: "language", report: { ...report, why: "no_change" } };
  return { pass: true, report };
}

Deno.serve(
  withAuditWrapper("prewarm-ugc-worker", async (req) => {
    if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

    // Wave 1 SEC-W1-001: service-role gate. Without this, any anon JWT can
    // trigger up to BATCH (50) paid AI translation calls per invocation.
    const auth = req.headers.get("authorization") ?? "";
    if (!SERVICE_KEY || auth !== `Bearer ${SERVICE_KEY}`) {
      console.warn(
        JSON.stringify({
          level: "warn",
          fn: "prewarm-ugc-worker",
          code: "unauthorized_worker_invocation",
          reason: !SERVICE_KEY ? "missing_service_key" : auth ? "invalid_token" : "missing_token",
          hasAuthorizationHeader: Boolean(auth),
          source: "edge.prewarm-ugc-worker",
        })
      );
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sb = createClient(SUPABASE_URL, SERVICE_KEY);

    // Cost guard: count today's translations via fast RPC (planner estimate when
    // the table is large enough that an exact COUNT would saturate the pool).
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { data: usedTodayData } = await sb.rpc("ugc_translations_count_fast", { p_since: since });
    const usedToday = typeof usedTodayData === "number" ? usedTodayData : 0;
    if ((usedToday ?? 0) >= DAILY_CAP) {
      return new Response(JSON.stringify({ skipped: "daily_cap", usedToday }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Pull a batch ordered realtime > batch > backfill
    const { data: jobs, error } = await sb
      .from("ugc_translation_jobs")
      .select("*")
      .eq("status", "pending")
      .order("priority", { ascending: true })
      .order("created_at", { ascending: true })
      .limit(BATCH);
    if (error) {
      console.error("queue_read", error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!jobs?.length)
      return new Response(JSON.stringify({ processed: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

    // Mark processing
    const ids = jobs.map((j: Job) => j.id);
    await sb
      .from("ugc_translation_jobs")
      .update({ status: "processing", updated_at: new Date().toISOString() })
      .in("id", ids);

    let ok = 0,
      failed = 0;
    const doneIds: string[] = [];
    const failedRows: { id: string; attempts: number; last_error: string }[] = [];
    for (const job of jobs as Job[]) {
      try {
        const tr = await translate(job.source_text, job.target_locale, job.content_format);
        if (!tr.ok) throw new Error(tr.reason);
        const q = qa(job.source_text, tr.out!, job.target_locale);
        const status = q.pass ? "qa_passed" : "qa_failed";

        await sb.from("ugc_translations").upsert(
          {
            entity_table: job.entity_table,
            entity_id: job.entity_id,
            column_name: job.column_name,
            target_locale: job.target_locale,
            source_locale: "en",
            source_hash: job.source_hash,
            translated_text: tr.out,
            content_format: job.content_format,
            status,
            qa_report: q.report,
          },
          { onConflict: "entity_table,entity_id,column_name,target_locale,source_hash" }
        );

        if (!q.pass) {
          await sb.from("i18n_qa_failures").insert({
            entity_table: job.entity_table,
            entity_id: job.entity_id,
            column_name: job.column_name,
            locale: job.target_locale,
            source_text: job.source_text,
            attempted_text: tr.out,
            gate_failed: q.gate ?? "unknown",
            qa_report: q.report,
          });
        }
        doneIds.push(job.id);
        ok++;
      } catch (e) {
        failed++;
        failedRows.push({
          id: job.id,
          attempts: (job as any).attempts ? (job as any).attempts + 1 : 1,
          last_error: String(e),
        });
      }
    }

    // Wave 3 PERF-W3-005: batch terminal status updates (was N individual UPDATEs).
    const nowIso = new Date().toISOString();
    if (doneIds.length) {
      await sb
        .from("ugc_translation_jobs")
        .update({ status: "done", updated_at: nowIso })
        .in("id", doneIds);
    }
    // Failed rows still need per-row attempts/last_error, so keep them individual.
    for (const f of failedRows) {
      await sb
        .from("ugc_translation_jobs")
        .update({
          status: "failed",
          attempts: f.attempts,
          last_error: f.last_error,
          updated_at: nowIso,
        })
        .eq("id", f.id);
    }

    return new Response(JSON.stringify({ processed: jobs.length, ok, failed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  })
);
