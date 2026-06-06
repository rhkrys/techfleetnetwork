// @edge-cron
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@4.3.6";
import { createEdgeLogger } from "../_shared/logger.ts";

// M-01: Lenient shape guard. SSRF allowlist + numeric clamps below stay authoritative.
const BodySchema = z.object({
  offset: z.number().optional(),
  limit: z.number().optional(),
  target_url: z.string().optional(),
}).passthrough();

import { withAuditWrapper } from "../_shared/audit.ts";
const log = createEdgeLogger("scrape-knowledge");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/** Allowlisted target domains for scraping — prevents SSRF (OWASP A10) */
const ALLOWED_SCRAPE_DOMAINS = new Set([
  "guide.techfleet.org",
  "www.techfleet.org",
  "techfleet.org",
]);

/** Max body size (8 KB) */
const MAX_BODY_BYTES = 8 * 1024;

serve(withAuditWrapper("scrape-knowledge", async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const requestId = crypto.randomUUID().substring(0, 8);
  log.info("handler", `Scrape request received [${requestId}]`, { requestId });

  try {
    // Auth check — only admins can trigger scraping (OWASP A01)
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ success: false, error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
    if (!anonKey) {
      throw new Error("Missing SUPABASE_ANON_KEY");
    }

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      anonKey,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ success: false, error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify admin role
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: adminRole } = await adminClient
      .from("user_roles")
      .select("id")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .single();

    if (!adminRole) {
      return new Response(
        JSON.stringify({ success: false, error: "Forbidden: admin role required" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate body size
    const contentLength = parseInt(req.headers.get("content-length") || "0", 10);
    if (contentLength > MAX_BODY_BYTES) {
      return new Response(
        JSON.stringify({ success: false, error: "Request body too large" }),
        { status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const rawScrapeBody = await req.json().catch(() => ({}));
    const parsedScrapeBody = BodySchema.safeParse(rawScrapeBody);
    if (!parsedScrapeBody.success) {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid body" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const { offset = 0, limit = 10, target_url = "https://guide.techfleet.org" } = parsedScrapeBody.data as { offset?: number; limit?: number; target_url?: string };

    // SSRF protection: validate target_url against allowlist (OWASP A10)
    let parsedTarget: URL;
    try {
      parsedTarget = new URL(target_url);
    } catch {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid target URL" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!["http:", "https:"].includes(parsedTarget.protocol) || !ALLOWED_SCRAPE_DOMAINS.has(parsedTarget.hostname)) {
      log.warn("ssrf", `Blocked SSRF attempt to ${target_url} by user ${user.id} [${requestId}]`, {
        requestId,
        targetUrl: target_url,
        userId: user.id,
      });
      return new Response(
        JSON.stringify({ success: false, error: "Target URL is not in the allowlist" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate numeric params
    const safeOffset = Math.max(0, Math.min(Number(offset) || 0, 10_000));
    const safeLimit = Math.max(1, Math.min(Number(limit) || 10, 50));

    log.info("config", `Scraping target_url="${target_url}", offset=${safeOffset}, limit=${safeLimit} [${requestId}]`, {
      requestId,
      targetUrl: target_url,
      offset: safeOffset,
      limit: safeLimit,
      userId: user.id,
    });

    const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");
    if (!FIRECRAWL_API_KEY) {
      log.error("config", `FIRECRAWL_API_KEY not configured [${requestId}]`, { requestId });
      return new Response(
        JSON.stringify({ success: false, error: "FIRECRAWL_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Step 1: Map the site
    log.info("map", `Mapping ${target_url} [${requestId}]`, { requestId, targetUrl: target_url });
    const mapRes = await fetch("https://api.firecrawl.dev/v1/map", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${FIRECRAWL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: target_url,
        limit: 500,
        includeSubdomains: false,
      }),
    });

    const mapData = await mapRes.json();
    if (!mapRes.ok) {
      log.error("map", `Firecrawl map API error [${requestId}]: HTTP ${mapRes.status}`, {
        requestId,
        httpStatus: mapRes.status,
        responseBody: JSON.stringify(mapData).substring(0, 500),
      });
      return new Response(
        JSON.stringify({ success: false, error: "Failed to map site" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const urls: string[] = (mapData.links || []).filter((u: string) => {
      // Validate each discovered URL against the allowlist too
      try {
        const p = new URL(u);
        return ALLOWED_SCRAPE_DOMAINS.has(p.hostname);
      } catch {
        return false;
      }
    });

    log.info("map", `Found ${urls.length} valid URLs. Processing offset=${safeOffset}, limit=${safeLimit} [${requestId}]`, {
      requestId,
      totalUrls: urls.length,
      offset: safeOffset,
      limit: safeLimit,
    });

    const batch = urls.slice(safeOffset, safeOffset + safeLimit);
    log.info("scrape", `Processing batch of ${batch.length} URLs (offset ${safeOffset}) [${requestId}]`, {
      requestId,
      batchSize: batch.length,
      offset: safeOffset,
    });

    let scraped = 0;
    let errors = 0;

    for (const url of batch) {
      try {
        log.info("scrape", `Scraping: ${url} [${requestId}]`, { requestId, url });
        const scrapeRes = await fetch("https://api.firecrawl.dev/v1/scrape", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${FIRECRAWL_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            url,
            formats: ["markdown"],
            onlyMainContent: true,
          }),
        });

        const scrapeData = await scrapeRes.json();
        if (!scrapeRes.ok) {
          log.error("scrape", `Firecrawl scrape error for ${url} [${requestId}]: HTTP ${scrapeRes.status}`, {
            requestId,
            url,
            httpStatus: scrapeRes.status,
          });
          errors++;
          continue;
        }

        const markdown = scrapeData.data?.markdown || scrapeData.markdown || "";
        const title = (scrapeData.data?.metadata?.title || scrapeData.metadata?.title || url).slice(0, 500);

        if (!markdown.trim()) {
          log.warn("scrape", `Empty content for ${url} — skipping [${requestId}]`, { requestId, url });
          continue;
        }

        // Truncate content to prevent oversized DB writes
        const safeContent = markdown.slice(0, 100_000);

        log.info("upsert", `Upserting ${url} (${safeContent.length} chars) [${requestId}]`, {
          requestId,
          url,
          title,
          contentLength: safeContent.length,
        });

        const { error: dbError } = await supabase
          .from("knowledge_base")
          .upsert(
            {
              url,
              title,
              content: safeContent,
              scraped_at: new Date().toISOString(),
            },
            { onConflict: "url" }
          );

        if (dbError) {
          log.error("upsert", `DB upsert error for ${url} [${requestId}]: ${dbError.message}`, {
            requestId,
            url,
            errorCode: dbError.code,
          }, dbError);
          errors++;
        } else {
          scraped++;
        }

        await new Promise((r) => setTimeout(r, 500));
      } catch (e) {
        log.error("scrape", `Exception processing ${url} [${requestId}]`, { requestId, url }, e);
        errors++;
      }
    }

    const nextOffset = safeOffset + safeLimit;
    const hasMore = nextOffset < urls.length;

    log.info("handler", `Scrape batch completed [${requestId}]: ${scraped} scraped, ${errors} errors, hasMore=${hasMore}`, {
      requestId,
      totalUrls: urls.length,
      batchSize: batch.length,
      scraped,
      errors,
      nextOffset: hasMore ? nextOffset : null,
      hasMore,
    });

    return new Response(
      JSON.stringify({
        success: true,
        total_urls: urls.length,
        batch_size: batch.length,
        scraped,
        errors,
        next_offset: hasMore ? nextOffset : null,
        has_more: hasMore,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    log.error("handler", `Unhandled exception [${requestId}]`, { requestId }, err);
    return new Response(
      JSON.stringify({
        success: false,
        error: "Internal server error",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}));