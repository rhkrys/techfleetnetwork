// @edge-cron
// Fleety Embedding service — generates 768-dim vectors for KB, playbooks, examples.
// Two modes:
//   POST { text: "..." }                 -> returns { embedding: number[] }   (auth: any signed-in user)
//   POST { mode: "backfill", limit?: 50, table?: "kb"|"playbooks"|"examples"|"all" }
//                                         -> embeds rows whose embedding IS NULL  (auth: admin or service role)
//
// Embeddings provider: Google Gemini gemini-embedding-001 (768-dim via
// outputDimensionality), called directly via the Generative Language API with
// GEMINI_API_KEY. Single embedding model across Fleety — see
// _shared/gemini-embed.ts. (text-embedding-004 was RETIRED by Google → HTTP 404,
// which silently broke retrieval; gemini-embedding-001 is the current model.)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "npm:zod@3.23.8";

import { withAuditWrapper } from "../_shared/audit.ts";
import {
  GEMINI_EMBED_DIM,
  GEMINI_EMBED_MODEL_TAG,
  geminiEmbedBody,
  geminiEmbedUrl,
  parseGeminiEmbedding,
} from "../_shared/gemini-embed.ts";

const BodySchema = z.object({}).passthrough();
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") || "";

async function embedText(text: string): Promise<number[]> {
  const trimmed = (text || "").slice(0, 8000);
  if (!trimmed.trim()) return new Array(GEMINI_EMBED_DIM).fill(0);

  // Single embedding model across Fleety: gemini-embedding-001 @768, task
  // RETRIEVAL_DOCUMENT for KB/playbook/example rows (see _shared/gemini-embed.ts).
  // No gateway fallback (UC-23) — if the key is missing we fail loudly rather
  // than silently embedding in a different vector space.
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not configured — cannot embed");
  }

  let lastErr = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(geminiEmbedUrl(GEMINI_API_KEY), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(geminiEmbedBody(trimmed, "RETRIEVAL_DOCUMENT")),
    });
    if (r.ok) {
      const v = parseGeminiEmbedding(await r.json());
      if (!v) throw new Error("Unexpected Gemini embedding shape/length");
      return v;
    }
    const body = await r.text();
    lastErr = `${r.status} ${body.slice(0, 200)}`;
    // Retry on rate limit / transient — exponential backoff + jitter (cap 8s).
    if (r.status === 429 || r.status >= 500) {
      const base = 500;
      const delay = Math.min(8000, base * Math.pow(2, attempt)) + Math.floor(Math.random() * 500);
      await new Promise((res) => setTimeout(res, delay));
      continue;
    }
    break;
  }
  throw new Error(`Gemini embed failed: ${lastErr}`);
}

function vecLiteral(v: number[]): string {
  return "[" + v.join(",") + "]";
}

serve(
  withAuditWrapper("fleety-embed", async (req) => {
    if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

    try {
      const auth = req.headers.get("Authorization") || "";
      const _raw = await req.json().catch(() => ({}));
      const _parsed = BodySchema.safeParse(_raw);
      const body: any = _parsed.success ? _parsed.data : {};
      const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

      // Cron / service-role path: bearer token == service role key OR
      // x-cron-secret matches CRON_SECRET. No user check; backfill only.
      const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";
      // Service-role match: either current SUPABASE_SERVICE_ROLE_KEY (sb_secret_… or JWT)
      // OR a legacy JWT whose decoded `role` claim is "service_role" (covers rotation
      // periods where cron jobs still hold the previous JWT).
      let isService = !!auth && auth === `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`;
      if (!isService && auth.startsWith("Bearer ")) {
        const token = auth.slice(7);
        const parts = token.split(".");
        if (parts.length === 3) {
          try {
            const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
            if (payload?.role === "service_role") isService = true;
          } catch (_e) {
            /* not a JWT — ignore */
          }
        }
      }
      const isCron = CRON_SECRET && req.headers.get("x-cron-secret") === CRON_SECRET;
      const isBackfill = body?.mode === "backfill";

      let isAdmin = false;
      const needsAuth = !(isService || (isCron && isBackfill));

      if (needsAuth) {
        if (!auth.startsWith("Bearer ")) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
          global: { headers: { Authorization: auth } },
        });
        const { data: userData } = await userClient.auth.getUser();
        if (!userData?.user) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const { data: roles } = await admin
          .from("user_roles")
          .select("role")
          .eq("user_id", userData.user.id);
        isAdmin = (roles ?? []).some((r: { role: string }) => r.role === "admin");
      }

      // Mode A: single embedding for query-time use
      if (typeof body.text === "string") {
        const v = await embedText(body.text);
        return new Response(JSON.stringify({ embedding: v }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Mode B: backfill — admin, service-role, or cron only
      if (body.mode === "backfill") {
        if (!(isService || isCron || isAdmin)) {
          return new Response(JSON.stringify({ error: "Admin only" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const limit = Math.min(Math.max(Number(body.limit) || 50, 1), 200);
        const table = (body.table as string) || "all";
        const result: Record<string, number> = {};

        // KB: title + content - paginate by id to dodge PostgREST vector-filter quirks
        if (table === "all" || table === "kb") {
          let lastId = "";
          let n = 0;
          let processed = 0;
          while (processed < limit) {
            const q = admin
              .from("knowledge_base")
              .select("id,title,content,embedding,embedding_model")
              .order("id", { ascending: true })
              .limit(50);
            if (lastId) q.gt("id", lastId);
            const { data: rows } = await q;
            if (!rows || rows.length === 0) break;
            for (const r of rows) {
              lastId = r.id;
              // Re-embed rows that are unembedded OR were embedded under a
              // previous model/pipeline. GEMINI_EMBED_MODEL_TAG marks the current
              // gemini-embedding-001 @768 RETRIEVAL_DOCUMENT pipeline, so rows
              // labeled anything else (incl. stale/mislabeled ones) get re-embedded
              // into the matching vector space.
              if (r.embedding && r.embedding_model === GEMINI_EMBED_MODEL_TAG) continue;
              try {
                const v = await embedText(`${r.title}\n\n${r.content}`);
                await admin
                  .from("knowledge_base")
                  .update({
                    embedding: vecLiteral(v) as unknown as number[],
                    embedding_model: GEMINI_EMBED_MODEL_TAG,
                    embedding_updated_at: new Date().toISOString(),
                  })
                  .eq("id", r.id);
                n++;
                processed++;
                if (processed >= limit) break;
              } catch (e) {
                console.error("kb embed fail", r.id, e);
              }
            }
          }
          result.kb = n;
        }

        if (table === "all" || table === "playbooks") {
          const { data: rows } = await admin
            .from("fleety_playbooks")
            .select("id,title,direct_answer,trigger_phrases,tags,intent,embedding")
            .limit(200);
          let n = 0;
          for (const r of (rows ?? []).filter((x: any) => !x.embedding).slice(0, limit)) {
            try {
              const blob = `${r.title}\nintent:${r.intent}\n${(r.trigger_phrases ?? []).join(", ")}\n${(r.tags ?? []).join(", ")}\n${r.direct_answer ?? ""}`;
              const v = await embedText(blob);
              await admin
                .from("fleety_playbooks")
                .update({
                  embedding: vecLiteral(v) as unknown as number[],
                  embedding_updated_at: new Date().toISOString(),
                })
                .eq("id", r.id);
              n++;
            } catch (e) {
              console.error("playbook embed fail", r.id, e);
            }
          }
          result.playbooks = n;
        }

        if (table === "all" || table === "examples") {
          const { data: rows } = await admin
            .from("fleety_examples")
            .select("id,title,deliverable_type,summary,excerpt,tags,embedding")
            .limit(200);
          let n = 0;
          for (const r of (rows ?? []).filter((x: any) => !x.embedding).slice(0, limit)) {
            try {
              const blob = `${r.title}\n${r.deliverable_type}\n${(r.tags ?? []).join(", ")}\n${r.summary ?? ""}\n${r.excerpt ?? ""}`;
              const v = await embedText(blob);
              await admin
                .from("fleety_examples")
                .update({
                  embedding: vecLiteral(v) as unknown as number[],
                  embedding_updated_at: new Date().toISOString(),
                })
                .eq("id", r.id);
              n++;
            } catch (e) {
              console.error("example embed fail", r.id, e);
            }
          }
          result.examples = n;
        }

        return new Response(JSON.stringify({ ok: true, embedded: result }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Mode C: single-slug resync — re-embed the matching framework://entity/<table>/<id>
      // KB row(s) for one or more slugs. Used after admin edits a description.
      if (Array.isArray(body.slugs) && body.slugs.length > 0 && typeof body.table === "string") {
        if (!(isService || isCron || isAdmin)) {
          return new Response(JSON.stringify({ error: "Admin only" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const slugs = (body.slugs as string[]).slice(0, 50);
        const tbl = body.table as string;
        if (!/^reference_[a-z_]+$/.test(tbl)) {
          return new Response(JSON.stringify({ error: "Invalid table" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const { data: refRows } = await admin.from(tbl).select("id, slug").in("slug", slugs);
        let n = 0;
        for (const r of (refRows ?? []) as Array<{ id: string; slug: string }>) {
          const { data: kbRows } = await admin
            .from("knowledge_base")
            .select("id, title, content")
            .like("url", `framework://entity/%/${r.id}`);
          for (const kb of kbRows ?? []) {
            try {
              const v = await embedText(`${kb.title}\n\n${kb.content}`);
              await admin
                .from("knowledge_base")
                .update({
                  embedding: vecLiteral(v) as unknown as number[],
                  embedding_updated_at: new Date().toISOString(),
                })
                .eq("id", kb.id);
              n++;
            } catch (e) {
              console.error("single-slug embed fail", kb.id, e);
            }
          }
        }
        return new Response(JSON.stringify({ ok: true, resynced: n }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(
        JSON.stringify({ error: "Provide { text }, { mode: 'backfill' }, or { slugs, table }" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    } catch (e) {
      console.error("fleety-embed error", e);
      return new Response(
        JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
  })
);
