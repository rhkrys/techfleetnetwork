// @edge-cron
// fill-content-gaps
// Admin-only. Scans every reference_* table for rows whose description is
// missing or under 20 chars, and asks Lovable AI to write Tech-Fleet-voice
// descriptions for them in batches of 10. Writes results back tagged as
// description_source='ai_generated' so admins can later filter for review.
import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@4.3.6";
import { withAuditWrapper } from "../_shared/audit.ts";

// M-01: Lenient shape guard. Existing TABLES filter below stays authoritative.
const BodySchema = z.object({
  table: z.string().optional(),
  dry_run: z.boolean().optional(),
}).passthrough();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TABLES: { table: string; entity: string }[] = [
  { table: "reference_workshops", entity: "workshop" },
  { table: "reference_stakeholders", entity: "stakeholder" },
  { table: "reference_skills", entity: "skill" },
  { table: "reference_tools", entity: "tool" },
  { table: "reference_practices", entity: "practice" },
  { table: "reference_activities", entity: "activity" },
  { table: "reference_deliverables", entity: "deliverable" },
  { table: "reference_duties", entity: "duty" },
  { table: "reference_resources", entity: "resource" },
  { table: "reference_projects", entity: "project type" },
  { table: "reference_project_milestones", entity: "project milestone" },
  { table: "reference_relationships", entity: "stakeholder relationship" },
  { table: "reference_company_types", entity: "company type" },
  { table: "reference_agile_methods", entity: "agile method" },
  { table: "reference_job_functions", entity: "job function" },
  { table: "reference_job_industries", entity: "job industry" },
  { table: "reference_job_specializations", entity: "job specialization" },
  { table: "reference_job_titles", entity: "job title" },
  { table: "reference_tech_job_categories", entity: "tech job category" },
];

const BATCH = 10;
const MAX_TABLE_ROWS = 200; // safety cap per table per invocation

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface GapRow { id: string; slug: string; name: string; category: string | null }

async function generateBatch(
  rows: GapRow[],
  entity: string,
  apiKey: string,
): Promise<Record<string, string>> {
  const list = rows.map((r, i) => `${i + 1}. ${r.name}${r.category ? ` (category: ${r.category})` : ""}`).join("\n");
  const prompt = `Write a clear, friendly description for each of the following Tech Fleet ${entity} entries. Audience: trainees on a real cross-functional project team. Voice: plain language, action-first, no jargon, no AI self-references, no client names invented. 2–4 sentences each, ~50–90 words. Explain what it is, when/why it matters on a project, and one concrete example or use.

${list}

Return descriptions via the write_descriptions tool. Order MUST match the input order.`;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 45_000);
  try {
    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "You write Tech Fleet reference-data descriptions. Always reply via the write_descriptions tool only." },
          { role: "user", content: prompt },
        ],
        tools: [{
          type: "function",
          function: {
            name: "write_descriptions",
            description: `Return one description per input ${entity}.`,
            parameters: {
              type: "object",
              properties: {
                items: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      index: { type: "integer", description: "1-based input index" },
                      description: { type: "string" },
                    },
                    required: ["index", "description"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["items"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "write_descriptions" } },
      }),
    });
    clearTimeout(t);
    if (!resp.ok) {
      console.warn(`gateway ${resp.status} for ${entity} batch`);
      return {};
    }
    const data = await resp.json();
    const argsRaw = data?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!argsRaw) return {};
    const parsed = JSON.parse(argsRaw) as { items?: { index: number; description: string }[] };
    const out: Record<string, string> = {};
    for (const item of parsed.items ?? []) {
      const row = rows[item.index - 1];
      if (row && item.description && item.description.trim().length >= 20) {
        out[row.id] = item.description.trim().slice(0, 4000);
      }
    }
    return out;
  } catch (e) {
    clearTimeout(t);
    console.warn(`batch error: ${e instanceof Error ? e.message : e}`);
    return {};
  }
}

Deno.serve(withAuditWrapper("fill-content-gaps", async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "missing auth" }, 401);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) return json({ error: "AI gateway key not configured" }, 500);

  const userClient = createClient(SUPABASE_URL, ANON, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);
  const { data: roleRow } = await userClient
    .from("user_roles").select("role").eq("user_id", userData.user.id).eq("role", "admin").maybeSingle();
  if (!roleRow) return json({ error: "admin only" }, 403);

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  let body: { table?: string; dry_run?: boolean } = {};
  try {
    const raw = await req.json();
    const parsed = BodySchema.safeParse(raw);
    if (parsed.success) body = parsed.data as typeof body;
  } catch { /* default */ }
  const targetTables = body.table
    ? TABLES.filter(t => t.table === body.table)
    : TABLES;
  if (targetTables.length === 0) return json({ error: "unknown table" }, 400);

  const summary: Record<string, { gaps: number; filled: number }> = {};
  let totalFilled = 0;
  const updatedSlugs: string[] = [];

  for (const { table, entity } of targetTables) {
    // Find gaps: null/blank/very-short description and not already AI-flagged-recent
    const { data: gaps, error: gapErr } = await supabase
      .from(table)
      .select("id, slug, name, category, description")
      .or("description.is.null,description.eq.")
      .limit(MAX_TABLE_ROWS);
    if (gapErr) {
      summary[table] = { gaps: 0, filled: 0 };
      console.warn(`[${table}] read error: ${gapErr.message}`);
      continue;
    }
    const realGaps = (gaps ?? []).filter((r: { description: string | null; name: string }) =>
      (!r.description || r.description.trim().length < 20) && r.name && r.name.trim().length > 0
    ) as unknown as Array<GapRow & { description: string | null }>;
    summary[table] = { gaps: realGaps.length, filled: 0 };
    if (realGaps.length === 0) continue;
    if (body.dry_run) continue;

    for (let i = 0; i < realGaps.length; i += BATCH) {
      const slice = realGaps.slice(i, i + BATCH).map(r => ({
        id: r.id, slug: r.slug, name: r.name, category: r.category,
      }));
      const written = await generateBatch(slice, entity, LOVABLE_API_KEY);
      for (const [id, description] of Object.entries(written)) {
        const { error: upErr } = await supabase
          .from(table)
          .update({
            description,
            description_source: "ai_generated",
            description_generated_at: new Date().toISOString(),
          })
          .eq("id", id);
        if (upErr) {
          console.warn(`[${table}] update ${id} failed: ${upErr.message}`);
          continue;
        }
        const slug = slice.find(s => s.id === id)?.slug;
        if (slug) updatedSlugs.push(`${entity}:${slug}`);
        summary[table].filled++;
        totalFilled++;
      }
    }
  }

  // Best-effort Fleety knowledge-base re-embed for changed slugs
  if (updatedSlugs.length > 0) {
    try {
      await supabase.functions.invoke("fleety-embed", {
        body: { reason: "content-gap-fill", slugs: updatedSlugs.slice(0, 500) },
      });
    } catch (e) {
      console.warn(`fleety-embed invoke failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  return json({ ok: true, total_filled: totalFilled, summary });
}));
