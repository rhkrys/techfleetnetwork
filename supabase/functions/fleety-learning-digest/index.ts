// @edge-cron
// Fleety Learning Digest
// ----------------------------------------------------------------------------
// Nightly cron-able function. Scans the last 7 days of fleety_turn_signals,
// clusters similar user queries (cheap normalized-key bucket), aggregates
// thumbs/up-down counts per cluster, flags zero-hit clusters as knowledge
// gaps, and writes the result into fleety_topic_insights for the admin
// /admin/fleety-coach page. Also auto-proposes new framework relationships
// when a "how does X relate to Y" question got a thumbs-up — admins still
// review before they're added to reference_relationships.
//
// Auth: requires service-role bearer token (called by pg_cron / admin only).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

import { withAuditWrapper } from "../_shared/audit.ts";
import { authorizeServiceRoleRequest } from "../_shared/service-role-auth.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "is",
  "are",
  "was",
  "were",
  "i",
  "you",
  "we",
  "they",
  "do",
  "does",
  "did",
  "to",
  "of",
  "in",
  "on",
  "for",
  "and",
  "or",
  "but",
  "what",
  "how",
  "why",
  "when",
  "where",
  "who",
  "which",
  "can",
  "could",
  "would",
  "should",
  "tell",
  "me",
  "about",
  "please",
  "my",
  "your",
]);

function normalizeQuery(q: string): string {
  return q
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w))
    .sort()
    .slice(0, 6)
    .join(" ");
}

function detectRelationshipQuestion(q: string): { from: string; to: string } | null {
  // matches "relationship between X and Y", "how does X relate to Y", "X vs Y"
  const m1 = q.match(/relationship\s+between\s+(.+?)\s+and\s+([^?.]+)/i);
  if (m1) return { from: m1[1].trim(), to: m1[2].trim() };
  const m2 = q.match(
    /how\s+(?:do|does|are)\s+(.+?)\s+(?:relate|related|connect|connected)\s+to\s+([^?.]+)/i
  );
  if (m2) return { from: m2[1].trim(), to: m2[2].trim() };
  return null;
}

serve(
  withAuditWrapper("fleety-learning-digest", async (req) => {
    if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

    // Auth: service-role only
    const auth = req.headers.get("authorization") ?? "";
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    // Service-role (constant-time exact key match) OR a verified admin JWT.
    // NEVER the public anon key (it ships in the frontend bundle) — audit C2.
    if (!authorizeServiceRoleRequest(req).ok) {
      // Allow only if caller can authenticate as admin
      const SUPABASE_ANON_KEY =
        Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
      const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: auth } },
      });
      const {
        data: { user },
      } = await userClient.auth.getUser();
      if (!user)
        return new Response(JSON.stringify({ error: "unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      const { data: roles } = await userClient
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id);
      if (!(roles ?? []).some((r: { role: string }) => r.role === "admin")) {
        return new Response(JSON.stringify({ error: "forbidden" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: signals, error } = await admin
      .from("fleety_turn_signals")
      .select("id, user_query, kb_hit_count, framework_hit_count, audience")
      .gte("created_at", since)
      .limit(2000);
    if (error)
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

    const { data: feedback } = await admin
      .from("fleety_message_feedback")
      .select("turn_id, rating")
      .gte("created_at", since);
    const fbMap = new Map<string, { up: number; down: number }>();
    for (const f of feedback ?? []) {
      const cur = fbMap.get(f.turn_id) ?? { up: 0, down: 0 };
      if (f.rating === 1) cur.up++;
      else cur.down++;
      fbMap.set(f.turn_id, cur);
    }

    // Cluster by normalized key
    type Cluster = {
      label: string;
      sample: string;
      count: number;
      up: number;
      down: number;
      gap: boolean;
    };
    const clusters = new Map<string, Cluster>();
    for (const s of signals ?? []) {
      const key = normalizeQuery(s.user_query);
      if (!key) continue;
      const c = clusters.get(key) ?? {
        label: key,
        sample: s.user_query,
        count: 0,
        up: 0,
        down: 0,
        gap: true,
      };
      c.count++;
      const fb = fbMap.get(s.id);
      if (fb) {
        c.up += fb.up;
        c.down += fb.down;
      }
      if (s.kb_hit_count > 0 || s.framework_hit_count > 0) c.gap = false;
      clusters.set(key, c);
    }

    // Replace insights snapshot
    await admin
      .from("fleety_topic_insights")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");
    const rows = [...clusters.values()]
      .filter((c) => c.count >= 2)
      .map((c) => ({
        label: c.label,
        sample_query: c.sample,
        query_count: c.count,
        gap: c.gap,
        thumbs_up: c.up,
        thumbs_down: c.down,
      }));
    if (rows.length > 0) await admin.from("fleety_topic_insights").insert(rows);

    // Auto-propose relationships from positively-rated relationship questions
    let proposedCount = 0;
    for (const s of signals ?? []) {
      const fb = fbMap.get(s.id);
      if (!fb || fb.up === 0) continue;
      const rel = detectRelationshipQuestion(s.user_query);
      if (!rel) continue;
      // Skip if a similar pending/approved one already exists
      const { data: existing } = await admin
        .from("fleety_proposed_relationships")
        .select("id")
        .ilike("from_entity", rel.from)
        .ilike("to_entity", rel.to)
        .limit(1);
      if (existing && existing.length > 0) continue;
      await admin.from("fleety_proposed_relationships").insert({
        from_entity: rel.from,
        to_entity: rel.to,
        description: `Users asked how ${rel.from} relate to ${rel.to}; admin should author the canonical sentence.`,
        source_turn_id: s.id,
      });
      proposedCount++;
    }

    // Recompute practical_score for recent turns (uses fleety_action_events
    // + thumbs feedback to flag whether users actually acted on the answer).
    let practicalUpdated = 0;
    try {
      const { data: pscore } = await admin.rpc("fleety_recompute_practical_scores", { p_days: 14 });
      practicalUpdated = typeof pscore === "number" ? pscore : 0;
    } catch (e) {
      console.warn("practical_score recompute failed", e);
    }

    // Auto-promote high-practical-score answers to disabled draft canned answers.
    // Admin must enable in System Health → Fleety. Only promotes turns where:
    //   • practical_score >= 0.70   (user clicked a chip / acted within 10 min)
    //   • >=1 thumbs_up, 0 thumbs_down
    //   • not already linked to a canned answer
    //   • no existing canned answer with the same trimmed question pattern
    let promotedDrafts = 0;
    try {
      const { data: candidates } = await admin
        .from("fleety_turn_signals")
        .select(
          "id, user_query, audience, conversation_id, canned_answer_id, practical_score, created_at"
        )
        .gte("created_at", since)
        .gte("practical_score", 0.7)
        .is("canned_answer_id", null)
        .limit(50);
      for (const t of candidates ?? []) {
        const fb = fbMap.get(t.id as string);
        if (!fb || fb.up < 1 || fb.down > 0) continue;
        const pattern = (t.user_query ?? "").trim().slice(0, 500);
        if (pattern.length < 8) continue;
        const { data: dup } = await admin
          .from("fleety_canned_answers")
          .select("id")
          .ilike("question_pattern", pattern)
          .limit(1);
        if (dup && dup.length > 0) continue;
        // Pull the assistant reply that immediately followed this turn.
        const { data: reply } = await admin
          .from("chat_messages")
          .select("content, created_at")
          .eq("conversation_id", t.conversation_id)
          .eq("role", "assistant")
          .gte("created_at", t.created_at as string)
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();
        const answer = (reply?.content ?? "").trim();
        if (!answer || answer.length < 40) continue;
        const { data: inserted, error: insErr } = await admin
          .from("fleety_canned_answers")
          .insert({
            question_pattern: pattern,
            answer_md: answer,
            audience: t.audience ?? "all",
            source_turn_id: t.id,
            enabled: false, // admin reviews before going live
          })
          .select("id")
          .single();
        if (insErr) {
          console.warn("auto-promote insert failed", insErr.message);
          continue;
        }
        await admin
          .from("fleety_turn_signals")
          .update({ canned_answer_id: inserted.id })
          .eq("id", t.id);
        promotedDrafts++;
      }
    } catch (e) {
      console.warn("auto-promote failed", e);
    }

    // ── Decay canned answers that earned thumbs-down within 7 days ────
    // Auto-disable so an admin can review before they go live again.
    let cannedDecayed = 0;
    try {
      const { data: badCanned } = await admin
        .from("fleety_turn_signals")
        .select("canned_answer_id, id")
        .gte("created_at", since)
        .not("canned_answer_id", "is", null);
      const cannedIds = new Set<string>();
      for (const row of badCanned ?? []) {
        const fb = fbMap.get((row as { id: string }).id);
        if (fb && fb.down > fb.up)
          cannedIds.add((row as { canned_answer_id: string }).canned_answer_id);
      }
      if (cannedIds.size > 0) {
        const { data: decayed } = await admin
          .from("fleety_canned_answers")
          .update({ enabled: false })
          .in("id", Array.from(cannedIds))
          .eq("enabled", true)
          .select("id");
        cannedDecayed = decayed?.length ?? 0;
      }
    } catch (e) {
      console.warn("canned-decay failed", e);
    }

    // ── Auto-author playbook DRAFTS for gap clusters ──────────────────
    // Cluster requirements: ≥3 turns, all how_to-ish, 0 thumbs_down, no
    // playbook hits, no existing draft for the same normalized label.
    let playbookDrafts = 0;
    try {
      const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") || "";
      if (LOVABLE_API_KEY) {
        // Re-cluster using how_to-only signals with playbook_hits=0
        const { data: gapSignals } = await admin
          .from("fleety_turn_signals")
          .select("id, user_query, intent, playbook_hits")
          .gte("created_at", since)
          .eq("playbook_hits", 0)
          .in("intent", ["how_to", "troubleshoot", "decision"])
          .limit(2000);
        const gapClusters = new Map<string, { sample: string; count: number; down: number }>();
        for (const s of gapSignals ?? []) {
          const key = normalizeQuery(s.user_query as string);
          if (!key) continue;
          const c = gapClusters.get(key) ?? { sample: s.user_query as string, count: 0, down: 0 };
          c.count++;
          const fb = fbMap.get(s.id as string);
          if (fb) c.down += fb.down;
          gapClusters.set(key, c);
        }
        const drafts = [...gapClusters.entries()]
          .filter(([, c]) => c.count >= 3 && c.down === 0)
          .slice(0, 5);
        for (const [label, c] of drafts) {
          // Skip if a playbook draft (active OR inactive) already exists for this slug
          const slugBase = label.replace(/\s+/g, "-").slice(0, 60) || `gap-${Date.now()}`;
          const slug = `draft-${slugBase}`;
          const { data: dup } = await admin
            .from("fleety_playbooks")
            .select("id")
            .eq("slug", slug)
            .limit(1);
          if (dup && dup.length > 0) continue;

          // Ask Gemini Flash to draft a structured playbook
          const prompt = `You are drafting a Tech Fleet playbook based on a recurring user question.\n\nQuestion (sample): "${c.sample}"\nObserved variants: ${c.count}\n\nReturn STRICT JSON with keys:\n{\n  "title": string (max 60 chars, action-oriented),\n  "intent": "how_to" | "troubleshoot" | "decision",\n  "direct_answer": string (1-2 plain-English sentences),\n  "steps": [{"title": string, "estimate": "5-15 min", "detail": string}, ... 3 items],\n  "done_criteria": [string, string, string],\n  "common_pitfalls": [string, string],\n  "ask_for_help": string,\n  "trigger_phrases": [string, string, string],\n  "tags": [string, string]\n}\nNo prose outside JSON.`;
          const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${LOVABLE_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "google/gemini-2.5-flash-lite",
              messages: [{ role: "user", content: prompt }],
              response_format: { type: "json_object" },
            }),
          });
          if (!r.ok) {
            console.warn("playbook draft AI fail", r.status);
            continue;
          }
          const j = await r.json();
          const txt = j?.choices?.[0]?.message?.content ?? "";
          let pb: Record<string, unknown>;
          try {
            pb = JSON.parse(txt);
          } catch {
            continue;
          }
          if (!pb.title || !pb.direct_answer || !Array.isArray(pb.steps)) continue;
          const { error: insErr } = await admin.from("fleety_playbooks").insert({
            slug,
            title: String(pb.title).slice(0, 80),
            intent: ["how_to", "troubleshoot", "decision"].includes(pb.intent as string)
              ? pb.intent
              : "how_to",
            audience: "all",
            direct_answer: String(pb.direct_answer).slice(0, 800),
            steps: pb.steps,
            done_criteria: Array.isArray(pb.done_criteria) ? pb.done_criteria : [],
            common_pitfalls: Array.isArray(pb.common_pitfalls) ? pb.common_pitfalls : [],
            ask_for_help: pb.ask_for_help ? String(pb.ask_for_help).slice(0, 300) : null,
            trigger_phrases: Array.isArray(pb.trigger_phrases)
              ? pb.trigger_phrases
              : [c.sample.slice(0, 80)],
            tags: Array.isArray(pb.tags) ? pb.tags : ["auto-draft"],
            action_chips: [],
            is_active: false, // admin must review and enable
          });
          if (insErr) {
            console.warn("playbook draft insert fail", insErr.message);
            continue;
          }
          playbookDrafts++;
        }
      }
    } catch (e) {
      console.warn("playbook-draft failed", e);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        signals: (signals ?? []).length,
        clusters: rows.length,
        proposed_relationships: proposedCount,
        practical_scores_updated: practicalUpdated,
        canned_drafts_promoted: promotedDrafts,
        canned_drafts_decayed: cannedDecayed,
        playbook_drafts_created: playbookDrafts,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  })
);
