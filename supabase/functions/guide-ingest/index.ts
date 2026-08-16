// @edge-cron
// guide-ingest — pulls guide.techfleet.org content into knowledge_base with REAL
// source links (PRD D-02). Replaces the retired Firecrawl scrape path: the guide is
// Tech Fleet's own site, so we discover pages from its published llms.txt index and
// fetch each as Markdown (append .md). Upserts by url; leaves embedding NULL so the
// fleety-embed backfill (cron/admin) vectorises new/changed pages. SSRF-guarded to
// the pinned host, no redirects. Auth: admin JWT, service role, or cron secret.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { withAuditWrapper } from "../_shared/audit.ts";
import { authorizeServiceRoleRequest } from "../_shared/service-role-auth.ts";
import { assertGuideUrlAllowed, GUIDE_LLMS_TXT, markdownUrlFor, parseLlmsTxt } from "./lib.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const MAX_PAGES = 400; // hard ceiling so a bloated llms.txt can't run unbounded
const FETCH_TIMEOUT_MS = 10_000;
const MAX_CONTENT_CHARS = 16_000; // bound stored content; embed slices to 8k anyway

/** Fetch text with an SSRF guard + timeout + NO redirect following. */
async function fetchGuideText(url: string): Promise<string> {
  assertGuideUrlAllowed(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: controller.signal, redirect: "error" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } finally {
    clearTimeout(timer);
  }
}

serve(
  withAuditWrapper("guide-ingest", async (req) => {
    if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json", Allow: "POST, OPTIONS" },
      });
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const auth = req.headers.get("Authorization") || "";
    const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";
    const isService = authorizeServiceRoleRequest(req).ok;
    const isCron = CRON_SECRET && req.headers.get("x-cron-secret") === CRON_SECRET;

    // Admin-or-machine gate (mirrors fleety-embed): a member must not be able to
    // trigger a full re-ingest.
    let isAdmin = false;
    if (!(isService || isCron)) {
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
      if (!isAdmin) {
        return new Response(JSON.stringify({ error: "Admin only" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    try {
      const indexText = await fetchGuideText(GUIDE_LLMS_TXT);
      const pages = parseLlmsTxt(indexText).slice(0, MAX_PAGES);

      let added = 0;
      let updated = 0;
      let unchanged = 0;
      let errored = 0;
      const errors: string[] = [];

      for (const page of pages) {
        try {
          const md = await fetchGuideText(markdownUrlFor(page.url));
          const content = md.slice(0, MAX_CONTENT_CHARS);

          // Skip untouched pages so we don't needlessly re-embed unchanged content.
          const { data: existing } = await admin
            .from("knowledge_base")
            .select("id, content")
            .eq("url", page.url)
            .maybeSingle();

          if (existing && existing.content === content) {
            unchanged++;
            continue;
          }

          // New/changed page: upsert and NULL the embedding so the fleety-embed
          // backfill re-vectorises it into the current gemini-embedding-001 space.
          const row = {
            url: page.url,
            title: page.title,
            content,
            embedding: null as unknown as number[] | null,
            embedding_model: null as string | null,
            scraped_at: new Date().toISOString(),
          };
          const { error: upErr } = await admin
            .from("knowledge_base")
            .upsert(row, { onConflict: "url" });
          if (upErr) throw new Error(upErr.message);
          if (existing) updated++;
          else added++;
        } catch (e) {
          // Per-page failure (e.g. a 404) must not abort the whole refresh; the
          // existing KB row for that URL is preserved unchanged (UC-16 edge).
          errored++;
          if (errors.length < 20) errors.push(`${page.url}: ${e instanceof Error ? e.message : e}`);
        }
      }

      return new Response(
        JSON.stringify({
          ok: true,
          pages: pages.length,
          added,
          updated,
          unchanged,
          errored,
          errors,
          note: "Embedding runs via fleety-embed backfill (cron/admin).",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } catch (e) {
      console.error("guide-ingest error", e);
      return new Response(
        JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  })
);
