// @edge-auth
import { withAuditWrapper } from "../_shared/audit.ts";
/**
 * triage-error
 *
 * Admin-invoked AI triage for an entry in `agent_fix_queue`.
 *
 * Cost discipline:
 *   - Hard cap: 20 AI calls/day across the whole tenant (claim_triage_budget RPC).
 *   - Single Lovable AI call per invocation (google/gemini-2.5-flash by default).
 *   - Caller must be an authenticated admin (JWT validated against has_role).
 *   - Result is persisted to agent_fix_queue, never returned with PII beyond
 *     what already lives in the audit_log row that produced it.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "npm:zod@4.3.6";

// M-01: Lenient shape guard. Existing fix_queue_id type check below stays authoritative.
const BodySchema = z
  .object({
    fix_queue_id: z.string().optional(),
  })
  .passthrough();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const DAILY_CAP = 20;
const MODEL = "google/gemini-2.5-flash";

type FixQueueRow = {
  id: string;
  fingerprint: string;
  event_type: string;
  source: string;
  error_message: string;
  occurrence_count: number;
  severity: string;
  status: string;
};

interface TriageOutput {
  root_cause_hypothesis: string;
  proposed_fix_summary: string;
  proposed_fix_files: Array<{ path: string; change_summary: string }>;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const SYSTEM_PROMPT = `You are an SRE/triage assistant for a TypeScript + React + Supabase Edge Functions codebase (Tech Fleet Network). Given a single error fingerprint with stack/source, produce STRICT JSON:
{
  "root_cause_hypothesis": "1-3 sentences. No fluff.",
  "proposed_fix_summary": "Plain-English plan an engineer can execute. 2-5 sentences.",
  "proposed_fix_files": [{"path":"src/...","change_summary":"what to change and why"}]
}
Rules:
- Only suggest files you can name with high confidence from the source/stack. If unknown, return [].
- Prefer minimal-blast-radius fixes. No speculative refactors.
- If the error is benign noise (e.g. ResizeObserver loop, ServiceWorker lock), say so and recommend dismissing.
- Return ONLY the JSON object. No markdown fences, no commentary.`;

Deno.serve(
  withAuditWrapper("triage-error", async (req) => {
    if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
    if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

    // --- AuthN / AuthZ -------------------------------------------------------
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!jwt) return jsonResponse({ error: "unauthorized" }, 401);

    const userClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) return jsonResponse({ error: "unauthorized" }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: isAdmin, error: roleErr } = await admin.rpc("has_role", {
      _user_id: userData.user.id,
      _role: "admin",
    });
    if (roleErr || !isAdmin) return jsonResponse({ error: "forbidden" }, 403);

    // --- Validate body -------------------------------------------------------
    let body: { fix_queue_id?: string };
    try {
      const raw = await req.json();
      const parsed = BodySchema.safeParse(raw);
      if (!parsed.success) return jsonResponse({ error: "bad_request" }, 400);
      body = parsed.data as { fix_queue_id?: string };
    } catch {
      return jsonResponse({ error: "bad_request" }, 400);
    }
    const fixId = body.fix_queue_id;
    if (!fixId || typeof fixId !== "string") {
      return jsonResponse({ error: "fix_queue_id required" }, 400);
    }

    // --- Load row ------------------------------------------------------------
    const { data: row, error: rowErr } = await admin
      .from("agent_fix_queue")
      .select("id,fingerprint,event_type,source,error_message,occurrence_count,severity,status")
      .eq("id", fixId)
      .maybeSingle<FixQueueRow>();
    if (rowErr || !row) return jsonResponse({ error: "not_found" }, 404);

    // --- Pre-AI silencer (TRIAGE-NOISE-030/031) ------------------------------
    // Refuse to spend AI budget on rows the permanent backstop already silences:
    //   (a) Opaque cross-origin "Script error." (first non-empty line regex).
    //   (b) Any active known_issue_catalog match (substring/regex/fingerprint),
    //       optionally scoped by event_type_filter.
    // On match: auto-resolve the row, skip the AI call, return 409.
    const firstLine =
      (row.error_message ?? "")
        .split(/\r?\n/)
        .map((l) => l.trim())
        .find((l) => l.length > 0) ?? "";
    const isOpaqueScriptError = /^(error:\s*)?script error\.?$/i.test(firstLine);

    let knownIssueMatch: { pattern: string } | null = null;
    if (!isOpaqueScriptError) {
      const { data: kicRows } = await admin
        .from("known_issue_catalog")
        .select("pattern,match_kind,event_type_filter")
        .eq("is_active", true);
      type Kic = { pattern: string; match_kind: string; event_type_filter: string | null };
      for (const k of (kicRows ?? []) as Kic[]) {
        if (k.event_type_filter && k.event_type_filter !== row.event_type) continue;
        const msg = row.error_message ?? "";
        let hit = false;
        if (k.match_kind === "substring") hit = msg.includes(k.pattern);
        else if (k.match_kind === "regex") {
          try {
            hit = new RegExp(k.pattern, "i").test(msg);
          } catch {
            hit = false;
          }
        } else if (k.match_kind === "fingerprint") hit = row.fingerprint === k.pattern;
        if (hit) {
          knownIssueMatch = { pattern: k.pattern };
          break;
        }
      }
    }

    if (isOpaqueScriptError || knownIssueMatch) {
      const reason = isOpaqueScriptError
        ? "[auto] silenced at triage: opaque cross-origin Script error (permanent DB backstop)"
        : `[auto] silenced at triage: known_issue_catalog match (${knownIssueMatch!.pattern.slice(0, 80)})`;
      await admin
        .from("agent_fix_queue")
        .update({
          status: "resolved",
          resolved_at: new Date().toISOString(),
          dismissed_reason: reason,
        })
        .eq("id", fixId);
      // Return 200 (not 409): auto-silence is a successful outcome, and
      // supabase-js treats any non-2xx as FunctionsHttpError, which the admin
      // UI then misreports as an edge function failure. Callers branch on
      // `auto_silenced` to render the silenced state.
      return jsonResponse(
        {
          ok: true,
          auto_silenced: true,
          reason: isOpaqueScriptError ? "opaque_script_error" : "known_issue_catalog_match",
          pattern: knownIssueMatch?.pattern ?? "Script error.",
          ai_call_skipped: true,
        },
        200
      );
    }

    // --- Claim daily budget --------------------------------------------------
    const { data: claimed, error: claimErr } = await admin.rpc("claim_triage_budget", {
      p_cap: DAILY_CAP,
    });
    if (claimErr) return jsonResponse({ error: "budget_check_failed" }, 500);
    if (!claimed) {
      return jsonResponse(
        {
          error: "daily_cap_reached",
          cap: DAILY_CAP,
          message: "Triage budget exhausted for today.",
        },
        429
      );
    }

    // --- Call Lovable AI -----------------------------------------------------
    const userPrompt = JSON.stringify({
      event_type: row.event_type,
      source: row.source,
      occurrence_count: row.occurrence_count,
      severity: row.severity,
      error_message: row.error_message.slice(0, 4000),
    });

    let aiResp: Response;
    try {
      aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: MODEL,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.2,
        }),
      });
    } catch (e) {
      console.error("[triage-error] AI fetch failed:", e);
      return jsonResponse({ error: "ai_unreachable" }, 502);
    }

    if (aiResp.status === 429) return jsonResponse({ error: "ai_rate_limited" }, 429);
    if (aiResp.status === 402) return jsonResponse({ error: "ai_payment_required" }, 402);
    if (!aiResp.ok) {
      const text = await aiResp.text().catch(() => "");
      return jsonResponse(
        { error: "ai_failed", status: aiResp.status, detail: text.slice(0, 500) },
        502
      );
    }

    const aiJson = (await aiResp.json().catch(() => null)) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    } | null;

    const content = aiJson?.choices?.[0]?.message?.content?.trim() ?? "";
    let parsed: TriageOutput;
    try {
      // Tolerate accidental ```json fences.
      const cleaned = content
        .replace(/^```(?:json)?/i, "")
        .replace(/```$/, "")
        .trim();
      parsed = JSON.parse(cleaned);
    } catch {
      return jsonResponse({ error: "ai_unparseable", raw: content.slice(0, 500) }, 502);
    }

    if (
      typeof parsed.root_cause_hypothesis !== "string" ||
      typeof parsed.proposed_fix_summary !== "string" ||
      !Array.isArray(parsed.proposed_fix_files)
    ) {
      return jsonResponse({ error: "ai_invalid_shape" }, 502);
    }

    const tokensIn = aiJson?.usage?.prompt_tokens ?? null;
    const tokensOut = aiJson?.usage?.completion_tokens ?? null;
    // Gemini 2.5 Flash gateway pricing (rough): ~$0.30/M in, ~$2.50/M out.
    const costEstimate = ((tokensIn ?? 0) * 0.3 + (tokensOut ?? 0) * 2.5) / 1_000_000;

    // --- Persist -------------------------------------------------------------
    const { error: updErr } = await admin
      .from("agent_fix_queue")
      .update({
        status: parsed.proposed_fix_files.length > 0 ? "proposed" : "triaged",
        root_cause_hypothesis: parsed.root_cause_hypothesis.slice(0, 2000),
        proposed_fix_summary: parsed.proposed_fix_summary.slice(0, 4000),
        proposed_fix_files: parsed.proposed_fix_files.slice(0, 20),
        triage_model: MODEL,
        triage_tokens_in: tokensIn,
        triage_tokens_out: tokensOut,
        triage_cost_estimate_usd: costEstimate,
        triaged_at: new Date().toISOString(),
      })
      .eq("id", fixId);

    if (updErr) {
      console.error("[triage-error] persist failed:", updErr);
      return jsonResponse({ error: "persist_failed" }, 500);
    }

    return jsonResponse({
      ok: true,
      fix_queue_id: fixId,
      status: parsed.proposed_fix_files.length > 0 ? "proposed" : "triaged",
      cost_estimate_usd: costEstimate,
    });
  })
);
