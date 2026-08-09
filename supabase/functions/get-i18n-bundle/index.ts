// @edge-auth
// Public edge function: serves curated i18n bundles from i18n_translations.
// No auth — returns only non-PII translation strings. ETag + SWR caching keep
// it CDN-cheap. See mem://features/i18n-runtime-translator + db-first-content.
import { createClient } from "npm:@supabase/supabase-js@2";
import { enforceEdgeRateLimit } from "../_shared/edge-rate-limit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, if-none-match",
  "Access-Control-Expose-Headers": "etag",
};

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const locale = (url.searchParams.get("locale") || "en").trim().toLowerCase();
    const namespace = (url.searchParams.get("namespace") || "common").trim();

    // Basic input validation (avoid SQL/abuse): BCP-47 + simple ns.
    if (
      !/^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i.test(locale) ||
      !/^[a-z][a-z0-9_-]{0,32}$/i.test(namespace)
    ) {
      return new Response(JSON.stringify({ error: "invalid locale or namespace" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // T-H: per-IP cap — this is an unauth service-role query + SHA-256 per miss,
    // and the cache is trivially bypassed by cycling locale/namespace. Bound it.
    const rl = await enforceEdgeRateLimit(req, {
      action: "i18n_bundle",
      max: 120,
      windowMinutes: 1,
    });
    if (!rl.allowed) {
      return new Response(JSON.stringify({ error: "rate_limited" }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json", "Retry-After": "60" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data, error } = await supabase
      .from("i18n_translations")
      .select("key, value, updated_at")
      .eq("locale", locale)
      .eq("namespace", namespace)
      .in("status", ["qa_passed", "approved"])
      .order("key", { ascending: true });

    if (error) {
      console.error("get-i18n-bundle query failed:", error.message);
      return new Response(JSON.stringify({ error: "internal_error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const rows = data ?? [];
    const strings: Record<string, string> = {};
    let maxUpdated = 0;
    for (const r of rows) {
      strings[r.key as string] = r.value as string;
      const ts = new Date(r.updated_at as string).getTime();
      if (ts > maxUpdated) maxUpdated = ts;
    }

    const body = JSON.stringify({ locale, namespace, version: maxUpdated, strings });
    const etag = 'W/"' + (await sha256Hex(body)).slice(0, 32) + '"';

    const ifNoneMatch = req.headers.get("if-none-match");
    if (ifNoneMatch && ifNoneMatch === etag) {
      return new Response(null, {
        status: 304,
        headers: {
          ...corsHeaders,
          etag,
          "Cache-Control": "public, max-age=300, stale-while-revalidate=86400",
        },
      });
    }

    return new Response(body, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        etag,
        "Cache-Control": "public, max-age=300, stale-while-revalidate=86400",
      },
    });
  } catch (err) {
    console.error("get-i18n-bundle error:", (err as Error).message);
    return new Response(JSON.stringify({ error: "internal_error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
