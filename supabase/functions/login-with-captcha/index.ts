import { corsHeaders } from "npm:@supabase/supabase-js@2.99.1/cors";
import { z } from "npm:zod@4.3.6";
import { createEdgeLogger } from "../_shared/logger.ts";
import { withAuditWrapper } from "../_shared/audit.ts";
import { checkEmailDomain, emailDomain } from "../_shared/email-domain-allowlist.ts";
import { isProductionOrigin, originHostFromRequest } from "../_shared/auth-hosts.ts";

const log = createEdgeLogger("login-with-captcha");
const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

const BodySchema = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(1).max(4096),
  captchaToken: z.string().trim().min(20).max(4096),
  attemptId: z.string().trim().uuid().optional(),
});

function jsonResponse(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, ...extraHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function clientIp(req: Request): string | undefined {
  return req.headers.get("cf-connecting-ip") ?? req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined;
}

function publicAuthError(status = 401) {
  return jsonResponse({ error: "Invalid email or password. Please try again." }, status);
}

function maskDomain(d: string): string {
  if (!d) return "(none)";
  // Don't leak full domain in logs; first letter + tld is enough to triage.
  const parts = d.split(".");
  const tld = parts.length > 1 ? parts[parts.length - 1] : "";
  const head = d[0] ?? "?";
  return `${head}***.${tld}`;
}

Deno.serve(withAuditWrapper("login-with-captcha", async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const requestId = crypto.randomUUID().slice(0, 8);
  const startedAt = Date.now();
  const originHost = originHostFromRequest(req);

  // LCL-FIX-001: Unconditional entry log (bypasses audit-policy fingerprint
  // elision so we always see invocations in function_edge_logs).
  // eslint-disable-next-line no-console
  console.log(`[login-with-captcha] ENTER req=${requestId} host=${originHost || "(none)"}`);

  let branch:
    | "config_missing"
    | "validate_fail"
    | "domain_reject"
    | "captcha_fail"
    | "token_4xx"
    | "token_5xx"
    | "throttle"
    | "ok"
    | "error" = "error";
  let exitStatus = 500;
  let parsed: ReturnType<typeof BodySchema.safeParse> | null = null;

  const exit = (status: number, b: typeof branch, body: unknown, extra: Record<string, string> = {}) => {
    branch = b;
    exitStatus = status;
    return jsonResponse(body, status, extra);
  };

  try {
    const secret = Deno.env.get("TURNSTILE_SECRET_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!secret || !supabaseUrl || !anonKey) {
      log.error("config", `Login CAPTCHA configuration missing [${requestId}]`, { requestId });
      return exit(503, "config_missing", { error: "Verification is temporarily unavailable. Please try again." });
    }

    parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) {
      log.warn("validate", `Invalid login payload [${requestId}]`, { requestId });
      return exit(400, "validate_fail", { error: "Complete the human verification before trying again." });
    }

    const domain = emailDomain(parsed.data.email);
    const domainCheck = await checkEmailDomain(domain);
    // eslint-disable-next-line no-console
    console.log(`[login-with-captcha] domain req=${requestId} dom=${maskDomain(domain)} branch=${domainCheck.branch} valid=${domainCheck.valid}`);
    if (!domainCheck.valid) {
      log.warn("validate", `Rejected login with non-existent email domain [${requestId}]`, { requestId, branch: domainCheck.branch });
      return exit(400, "domain_reject", { error: "Use an email address with a real domain." });
    }

    // Production secret. For non-production origins (Lovable preview/sandbox/localhost)
    // the widget uses Cloudflare's "always passes" test sitekey, which only validates
    // against the matching test secret. We try the real secret first, then fall back
    // to the test secret only when the request originated from a non-production host.
    const TEST_SECRET = "1x0000000000000000000000000000000AA";
    const isProd = isProductionOrigin(originHost);
    const ip = clientIp(req);

    async function verifyCaptcha(secretKey: string) {
      const verifyForm = new FormData();
      verifyForm.set("secret", secretKey);
      verifyForm.set("response", parsed.data.captchaToken);
      if (ip) verifyForm.set("remoteip", ip);
      const r = await fetch(VERIFY_URL, { method: "POST", body: verifyForm });
      const j = await r.json().catch(() => ({})) as { success?: boolean; "error-codes"?: string[] };
      return { ok: r.ok, status: r.status, body: j };
    }

    let captchaCheck = await verifyCaptcha(secret);
    if ((!captchaCheck.ok || captchaCheck.body.success !== true) && !isProd) {
      const fallback = await verifyCaptcha(TEST_SECRET);
      if (fallback.ok && fallback.body.success === true) captchaCheck = fallback;
    }

    if (!captchaCheck.ok || captchaCheck.body.success !== true) {
      log.warn("captcha", `Turnstile rejected login [${requestId}]`, {
        requestId,
        status: captchaCheck.status,
        errorCodes: captchaCheck.body["error-codes"] ?? [],
        originHost,
      });
      return exit(403, "captcha_fail", { error: "Complete the human verification before trying again.", code: "CAPTCHA_REQUIRED" });
    }

    const authResponse = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email: parsed.data.email, password: parsed.data.password }),
    });

    const authBody = await authResponse.json().catch(() => ({}));
    if (!authResponse.ok) {
      log.warn("auth", `Password login rejected after CAPTCHA [${requestId}]`, { requestId, status: authResponse.status });
      if (authResponse.status === 429) {
        return exit(
          429,
          "throttle",
          { error: "Too many rapid auth attempts. Complete the human verification before trying again.", code: "AUTH_THROTTLE_CAPTCHA_REQUIRED" },
          { "Retry-After": authResponse.headers.get("Retry-After") ?? "60" },
        );
      }
      const isServer = authResponse.status >= 500;
      return exit(
        isServer ? authResponse.status : (authResponse.status === 400 ? 401 : authResponse.status),
        isServer ? "token_5xx" : "token_4xx",
        { error: "Invalid email or password. Please try again." },
      );
    }

    log.info("auth", `Password login passed server CAPTCHA gate [${requestId}]`, { requestId });
    branch = "ok";
    exitStatus = 200;
    return jsonResponse({ session: authBody, user: authBody.user ?? null });
  } catch (err) {
    log.error("handler", `Unhandled login CAPTCHA error [${requestId}]`, { requestId }, err);
    return exit(500, "error", { error: "Verification failed. Please try again." });
  } finally {
    // LCL-FIX-001: Unconditional exit log.
    // eslint-disable-next-line no-console
    console.log(`[login-with-captcha] EXIT req=${requestId} status=${exitStatus} branch=${branch} duration_ms=${Date.now() - startedAt}`);

    // Persist a telemetry row for every invocation so the System Health
    // Login tab can surface failure-branch counts. Best-effort, never blocks.
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      const body = (parsed?.success ? parsed.data : null) as { email?: string; attemptId?: string } | null;
      if (supabaseUrl && serviceKey && body?.attemptId) {
        const ip = clientIp(req) ?? null;
        await fetch(`${supabaseUrl}/rest/v1/rpc/record_login_event`, {
          method: "POST",
          headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            p_attempt_id: body.attemptId,
            p_outcome: branch === "ok" ? "edge_entered" : (
              branch === "captcha_fail" ? "captcha_failed" :
              branch === "domain_reject" ? "domain_reject" :
              branch === "throttle" ? "auth_throttle" :
              branch === "token_4xx" ? "invalid_credentials" :
              branch === "token_5xx" ? "server_error" :
              branch === "validate_fail" ? "unknown" :
              branch === "config_missing" ? "server_error" :
              "edge_entered"
            ),
            p_branch: branch,
            p_http_status: exitStatus,
            p_duration_ms: Date.now() - startedAt,
            p_email: body.email ?? null,
            p_ip: ip,
            p_user_agent: req.headers.get("user-agent")?.slice(0, 120) ?? null,
            p_origin_host: originHost,
            p_request_id: requestId,
            p_user_id: null,
          }),
        }).catch(() => undefined);
      }
    } catch { /* telemetry must never fail */ }
  }
}));
