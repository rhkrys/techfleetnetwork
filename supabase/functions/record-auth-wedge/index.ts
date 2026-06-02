// supabase/functions/record-auth-wedge/index.ts
//
// Fire-and-forget counter for client auth-recovery events. The client beacons
// here whenever it had to purge a wedged session (corrupt JWT, fingerprint
// mismatch, etc.). Admins watch the rate from System Health; a spike means
// a backend key rotation or a client bug.
//
// Public-by-design (no JWT) — anything that beacons a wedge is by definition
// unable to present a valid JWT. Rate-limited per-IP at the edge to bound
// abuse, and the body is fully validated before insert.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "../_shared/http.ts";

const ALLOWED_REASONS = new Set([
  "jwt_corrupt",
  "refresh_invalid",
  "fingerprint_mismatch",
  "shape_invalid",
]);
const ALLOWED_SOURCES = new Set([
  "bootstrap",
  "fetch_guard",
  "signin",
  "oauth",
  "signout",
  "other",
]);

// Per-IP token bucket — 30 events/hour is plenty for legitimate recovery.
const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const ipHits = new Map<string, { count: number; windowStart: number }>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const cur = ipHits.get(ip);
  if (!cur || now - cur.windowStart > RATE_LIMIT_WINDOW_MS) {
    ipHits.set(ip, { count: 1, windowStart: now });
    return false;
  }
  cur.count += 1;
  return cur.count > RATE_LIMIT_MAX;
}

async function hashIp(ip: string): Promise<string> {
  const day = new Date().toISOString().slice(0, 10);
  const data = new TextEncoder().encode(`${ip}|${day}|tfn_wedge_salt_v1`);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405, headers: corsHeaders });
  }

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("cf-connecting-ip") ||
    "unknown";
  if (rateLimited(ip)) {
    return new Response(JSON.stringify({ ok: false, error: "rate_limited" }), {
      status: 429,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "invalid_json" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const reason = String(body.reason ?? "");
  const source = String(body.source ?? "other");
  if (!ALLOWED_REASONS.has(reason) || !ALLOWED_SOURCES.has(source)) {
    return new Response(JSON.stringify({ ok: false, error: "invalid_enum" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const userAgent = typeof body.user_agent === "string" ? body.user_agent.slice(0, 200) : null;
  const route = typeof body.route === "string" ? body.route.slice(0, 200) : null;
  const releaseTag = typeof body.release_tag === "string" ? body.release_tag.slice(0, 64) : null;

  const ipHashValue = await hashIp(ip);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  const { error } = await supabase.from("auth_wedge_events").insert({
    reason,
    source,
    user_agent: userAgent,
    ip_hash: ipHashValue,
    route,
    release_tag: releaseTag,
  });

  if (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
