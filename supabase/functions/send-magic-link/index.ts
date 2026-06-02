/**
 * send-magic-link
 *
 * Escape hatch for users whose Turnstile widget is blocked (Brave, corporate
 * proxy, ad-blocker, transient Cloudflare outage). We generate a magic-link
 * server-side via the Supabase admin SDK and email it via the existing
 * transactional queue.
 *
 * Hardening:
 *   - Per-IP rate limit: 3 requests / 60 min (in-memory; isolate-local but
 *     good enough given pgmq dedupe + Supabase auth's own limits).
 *   - Email domain check via the shared fail-open helper (same as login).
 *   - Anti-enumeration: always return 200 with a generic "if the account
 *     exists you'll get an email" message; never confirm whether the email
 *     resolves to a real account.
 */
import { corsHeaders } from "../_shared/http.ts";
import { z } from "npm:zod@4.3.6";
import { createClient } from "npm:@supabase/supabase-js@2.99.1";
import { withAuditWrapper } from "../_shared/audit.ts";
import { createEdgeLogger } from "../_shared/logger.ts";
import { checkEmailDomain, emailDomain } from "../_shared/email-domain-allowlist.ts";
import { originHostFromRequest } from "../_shared/auth-hosts.ts";

const log = createEdgeLogger("send-magic-link");

const BodySchema = z.object({
  email: z.string().trim().email().max(320),
  redirectTo: z.string().url().max(1024).optional(),
});

const RATE_WINDOW_MS = 60 * 60_000;
const RATE_MAX = 3;
const ipBuckets = new Map<string, number[]>();

function clientIp(req: Request): string {
  return req.headers.get("cf-connecting-ip")
    ?? req.headers.get("x-real-ip")
    ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? "unknown";
}

function rateAllow(ip: string): boolean {
  const now = Date.now();
  const arr = (ipBuckets.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (arr.length >= RATE_MAX) {
    ipBuckets.set(ip, arr);
    return false;
  }
  arr.push(now);
  ipBuckets.set(ip, arr);
  return true;
}

function jsonResponse(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, ...extra, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

// Generic success payload — never confirm account existence.
const GENERIC_OK = {
  ok: true,
  message: "If an account exists for that email, we've sent a sign-in link. Please check your inbox.",
};

Deno.serve(withAuditWrapper("send-magic-link", async (req) => {
  // @public-route Pre-auth magic-link fallback for users whose Turnstile is blocked.
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const requestId = crypto.randomUUID().slice(0, 8);
  const ip = clientIp(req);
  const originHost = originHostFromRequest(req);

  // eslint-disable-next-line no-console
  console.log(`[send-magic-link] ENTER req=${requestId} host=${originHost || "(none)"}`);

  try {
    if (!rateAllow(ip)) {
      log.warn("rate", `Magic-link rate limit hit [${requestId}]`, { requestId });
      return jsonResponse(
        { error: "Too many magic-link requests. Please wait an hour before trying again." },
        429,
        { "Retry-After": "3600" },
      );
    }

    const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return jsonResponse({ error: "Enter a valid email address." }, 400);
    }

    const domain = emailDomain(parsed.data.email);
    const domainCheck = await checkEmailDomain(domain);
    if (!domainCheck.valid) {
      // Anti-enumeration: still return generic 200.
      return jsonResponse(GENERIC_OK);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) {
      log.error("config", `Missing service-role config [${requestId}]`, { requestId });
      return jsonResponse({ error: "Magic-link service is temporarily unavailable." }, 503);
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Use Supabase's built-in magic-link flow. It honors auth.email_template
    // "magic_link" and dispatches via the configured email provider (which
    // routes through our pgmq transactional queue when configured).
    const redirectTo = parsed.data.redirectTo ?? `${supabaseUrl.replace(/\/$/, "")}/auth/callback`;
    const { error } = await admin.auth.signInWithOtp({
      email: parsed.data.email,
      options: { emailRedirectTo: redirectTo, shouldCreateUser: false },
    });

    if (error) {
      log.warn("send", `Magic-link send failed [${requestId}]`, { requestId, status: error.status, message: error.message });
      // Still return generic 200 to prevent enumeration.
    }

    return jsonResponse(GENERIC_OK);
  } catch (err) {
    log.error("handler", `Unhandled magic-link error [${requestId}]`, { requestId }, err);
    // Generic 200 even on errors — never reveal existence or surface internals.
    return jsonResponse(GENERIC_OK);
  } finally {
    // eslint-disable-next-line no-console
    console.log(`[send-magic-link] EXIT req=${requestId}`);
  }
}));
