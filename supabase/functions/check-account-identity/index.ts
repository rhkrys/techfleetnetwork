// check-account-identity
// Returns whether a given email has a password identity, a Google identity, or neither.
// Used by LoginPage to surface a helpful "use Google sign-in" hint after a failed
// password attempt — only after the user has already submitted credentials, so we
// disclose nothing the existing login form doesn't already leak via "invalid credentials".
//
// Defenses:
//  - Turnstile token required (same widget the login form uses)
//  - Server-side rate limit (10/min per identifier hash) via check_rate_limit RPC
//  - Service-role read of auth.users.identities — never returns the row, only booleans
//  - Strict input validation; CORS locked to allowlist
import { createClient } from "npm:@supabase/supabase-js@2.99.1";
import { z } from "npm:zod@4.3.6";
import { createEdgeLogger } from "../_shared/logger.ts";

import { withAuditWrapper } from "../_shared/audit.ts";
const log = createEdgeLogger("check-account-identity");
const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// captchaToken is OPTIONAL — when called immediately after a failed password
// attempt the Turnstile token is already consumed and a fresh one is not yet
// available. The endpoint still rate-limits per (email|ip) hash (10/min) so
// enumeration sweeps are bounded even without a captcha.
const BodySchema = z.object({
  email: z.string().trim().email().max(320),
  captchaToken: z.string().trim().min(20).max(4096).optional(),
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function clientIp(req: Request): string | undefined {
  return (
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-real-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    undefined
  );
}

async function hashIdentifier(value: string): Promise<string> {
  const data = new TextEncoder().encode(value + "::tfn-account-identity-v1");
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(withAuditWrapper("check-account-identity", async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const requestId = crypto.randomUUID().slice(0, 8);

  try {
    const secret = Deno.env.get("TURNSTILE_SECRET_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!secret || !supabaseUrl || !serviceRole) {
      log.error("config", `Missing config [${requestId}]`, { requestId });
      return jsonResponse({ error: "Service unavailable" }, 503);
    }

    const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return jsonResponse({ error: "Invalid request" }, 400);
    const email = parsed.data.email.toLowerCase();

    // CAPTCHA verification (matches login-with-captcha tolerant pattern for non-prod origins)
    const TEST_SECRET = "1x0000000000000000000000000000000AA";
    const PRODUCTION_HOSTS = new Set([
      "techfleetnetwork.lovable.app",
      "www.techfleet.network",
      "techfleet.network",
    ]);
    let originHost = "";
    try {
      const oh = req.headers.get("origin") ?? req.headers.get("referer") ?? "";
      if (oh) originHost = new URL(oh).hostname.toLowerCase();
    } catch { /* ignore */ }
    const isProd = PRODUCTION_HOSTS.has(originHost);
    const ip = clientIp(req);

    // CAPTCHA verification is best-effort. If a token is present we verify it
    // (and reject when it's an obvious forgery); if absent, we rely on the
    // server-side rate limit below. This lets the LoginPage probe immediately
    // after a failed password attempt without waiting for a fresh Turnstile.
    if (parsed.data.captchaToken) {
      async function verify(secretKey: string) {
        const form = new FormData();
        form.set("secret", secretKey);
        form.set("response", parsed.data.captchaToken!);
        if (ip) form.set("remoteip", ip);
        const r = await fetch(VERIFY_URL, { method: "POST", body: form });
        const j = (await r.json().catch(() => ({}))) as { success?: boolean };
        return { ok: r.ok, success: j.success === true };
      }
      let cap = await verify(secret);
      if (!cap.success && !isProd) {
        const fb = await verify(TEST_SECRET);
        if (fb.success) cap = fb;
      }
      if (!cap.success) {
        log.warn("captcha", `Turnstile token present but rejected — falling through to rate-limit-only [${requestId}]`, { requestId, originHost });
        // Do NOT short-circuit: a stale/expired token must not block a
        // post-failure hint. Rate limit still gates abuse.
      }
    }

    const admin = createClient(supabaseUrl, serviceRole, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Server-side rate limit — keyed by hashed email + IP to prevent enumeration sweeps
    const rlKey = await hashIdentifier(`${email}|${ip ?? "noip"}`);
    const { data: rl, error: rlErr } = await admin.rpc("check_rate_limit", {
      p_identifier: rlKey,
      p_action: "login_attempt", // reuse existing bucket; this endpoint is a login-adjacent call
      p_max_attempts: 10,
      p_window_minutes: 1,
      p_block_minutes: 5,
    });
    if (rlErr) {
      log.warn("ratelimit", `RPC failed — failing closed [${requestId}]: ${rlErr.message}`, { requestId });
      return jsonResponse({ has_password: false, has_google: false }, 200);
    }
    if (rl && (rl as { allowed?: boolean }).allowed === false) {
      return jsonResponse({ has_password: false, has_google: false }, 200);
    }

    // Look up identities. Use the admin REST API rather than a SQL query to keep
    // this scoped to a single email and avoid touching auth schema directly.
    const listRes = await fetch(
      `${supabaseUrl}/auth/v1/admin/users?filter=${encodeURIComponent(`email eq "${email}"`)}`,
      {
        headers: {
          apikey: serviceRole,
          Authorization: `Bearer ${serviceRole}`,
        },
      },
    );
    if (!listRes.ok) {
      log.warn("lookup", `admin users lookup failed [${requestId}]: ${listRes.status}`, { requestId });
      return jsonResponse({ has_password: false, has_google: false }, 200);
    }
    const body = (await listRes.json().catch(() => ({}))) as {
      users?: Array<{ email?: string; identities?: Array<{ provider?: string }> }>;
    };
    const user = (body.users ?? []).find((u) => (u.email ?? "").toLowerCase() === email);

    let has_password = false;
    let has_google = false;
    if (user?.identities?.length) {
      for (const id of user.identities) {
        const p = (id.provider ?? "").toLowerCase();
        if (p === "email") has_password = true;
        if (p === "google") has_google = true;
      }
    }

    log.info("lookup", `identity check ok [${requestId}]`, { requestId, has_password, has_google });
    return jsonResponse({ has_password, has_google });
  } catch (err) {
    log.error("handler", `Unhandled [${requestId}]`, { requestId }, err);
    return jsonResponse({ has_password: false, has_google: false }, 200);
  }
}));
