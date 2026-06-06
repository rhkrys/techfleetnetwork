// @edge-cron
// fleety-bulk-draft-playbooks
// Admin-only edge function that drafts playbooks (is_active=false) for
// Tech Fleet framework entities (deliverables / milestones / workshops) that
// don't yet have a matching active playbook. Drafts land in the Fleety Coach
// "Drafts" tab for human review before going live. Uses Gemini Flash via the
// Lovable AI Gateway with structured tool-calling for schema safety.
import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@4.3.6";

import { withAuditWrapper } from "../_shared/audit.ts";

// M-01: Lenient shape guard. Existing entity allow-list + clamp below stay authoritative.
const BodySchema = z.object({
  entity: z.string().optional(),
  limit: z.number().optional(),
}).passthrough();
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Entity = { table: string; entityType: string; intent: string };
const ENTITIES: Record<string, Entity> = {
  deliverable: { table: "reference_deliverables", entityType: "deliverable", intent: "how_to" },
  milestone: { table: "reference_project_milestones", entityType: "project_milestone", intent: "how_to" },
  workshop: { table: "reference_workshops", entityType: "workshop", intent: "how_to" },
};

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60);
}

Deno.serve(withAuditWrapper("fleety-bulk-draft-playbooks", async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);

  // Auth: require admin JWT.
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

  // Parse body
  let body: { entity?: string; limit?: number } = {};
  try {
    const raw = await req.json();
    const parsed = BodySchema.safeParse(raw);
    if (parsed.success) body = parsed.data as typeof body;
  } catch { /* default */ }
  const entityKey = (body.entity || "deliverable").toLowerCase();
  const ent = ENTITIES[entityKey];
  if (!ent) return json({ error: `entity must be one of ${Object.keys(ENTITIES).join(", ")}` }, 400);
  const limit = Math.max(1, Math.min(10, body.limit || 5));

  // Find candidate entities NOT already covered by an active playbook
  // (matched naively by slug containment in title or trigger phrases).
  const { data: candidates, error: candErr } = await supabase
    .from(ent.table)
    .select("id, slug, name, description, category")
    .eq("is_active", true)
    .order("name");
  if (candErr) return json({ error: candErr.message }, 500);

  const { data: existingPbs } = await supabase
    .from("fleety_playbooks").select("title, slug, related_entity_slugs");
  const coveredSlugs = new Set<string>();
  for (const p of existingPbs ?? []) {
    for (const s of (p as any).related_entity_slugs ?? []) coveredSlugs.add(s);
  }
  const uncovered = (candidates ?? []).filter((c: any) => !coveredSlugs.has(c.slug)).slice(0, limit);
  if (uncovered.length === 0) return json({ ok: true, drafted: 0, reason: "no uncovered entities" });

  let drafted = 0;
  const drafts: Array<{ slug: string; title: string }> = [];

  for (const c of uncovered as any[]) {
    const prompt = `You're drafting a practical playbook for a Tech Fleet trainee about how to produce or run: "${c.name}" (${ent.entityType}). Description: ${c.description || "(none)"}. Category: ${c.category || "(none)"}.

Write a coaching answer in the structure of a Tech Fleet Fleety playbook. Be concrete, action-first, and assume the user is mid-deliverable. Do not mention you are an AI. Do not invent client names. Use plain language at a 6th-grade reading level. The audience is a trainee on a real project. Use the draft tool to return the structured playbook.`;

    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 25_000);
      const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
        signal: ctrl.signal,
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: "You draft Tech Fleet Fleety coaching playbooks. Always reply via the draft tool only." },
            { role: "user", content: prompt },
          ],
          tools: [{
            type: "function",
            function: {
              name: "draft",
              description: "Draft a Fleety playbook.",
              parameters: {
                type: "object",
                properties: {
                  title: { type: "string", description: "Short imperative title (e.g. 'Draft a research plan')" },
                  when_to_use: { type: "string" },
                  direct_answer: { type: "string", description: "1-3 sentence direct answer to 'what do I do next?'" },
                  steps: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        label: { type: "string" },
                        detail: { type: "string" },
                      },
                      required: ["label", "detail"],
                      additionalProperties: false,
                    },
                  },
                  done_criteria: { type: "array", items: { type: "string" } },
                  common_pitfalls: { type: "array", items: { type: "string" } },
                  ask_for_help: { type: "string" },
                  trigger_phrases: { type: "array", items: { type: "string" } },
                },
                required: ["title", "when_to_use", "direct_answer", "steps", "done_criteria", "common_pitfalls", "trigger_phrases"],
                additionalProperties: false,
              },
            },
          }],
          tool_choice: { type: "function", function: { name: "draft" } },
        }),
      });
      clearTimeout(t);
      if (!resp.ok) {
        console.warn(`gateway ${resp.status} for ${c.name}`);
        continue;
      }
      const data = await resp.json();
      const argsRaw = data?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
      if (!argsRaw) continue;
      const draft = JSON.parse(argsRaw);
      const slug = `auto-${ent.entityType}-${slugify(c.name)}`.slice(0, 80);
      const { error: insErr } = await supabase.from("fleety_playbooks").insert({
        slug,
        title: draft.title?.slice(0, 140) || c.name,
        intent: ent.intent,
        audience: "all",
        trigger_phrases: (draft.trigger_phrases ?? []).slice(0, 12),
        when_to_use: draft.when_to_use ?? "",
        direct_answer: draft.direct_answer ?? "",
        steps: draft.steps ?? [],
        done_criteria: (draft.done_criteria ?? []).slice(0, 12),
        common_pitfalls: (draft.common_pitfalls ?? []).slice(0, 12),
        ask_for_help: draft.ask_for_help ?? null,
        related_entity_types: [ent.entityType],
        related_entity_slugs: [c.slug],
        action_chips: [],
        tags: ["auto-draft", ent.entityType],
        is_active: false,
        created_by: userData.user.id,
      });
      if (insErr) {
        console.warn(`insert failed for ${slug}:`, insErr.message);
        continue;
      }
      drafted++;
      drafts.push({ slug, title: draft.title });
    } catch (e) {
      console.warn(`draft error for ${c.name}:`, e instanceof Error ? e.message : e);
    }
  }

  return json({ ok: true, entity: entityKey, drafted, drafts });
}));

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
