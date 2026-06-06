// @edge-cron
import { createEdgeLogger } from "../_shared/logger.ts";

import { withAuditWrapper } from "../_shared/audit.ts";
const log = createEdgeLogger("client-rate-limit-log");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const VALID_REASONS = new Set(["auth_lockout", "auth_throttle_captcha", "request_throttle"]);
const VALID_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
const PATH_RE = /^\/(?:auth|rest|functions)\/v1\/[a-z0-9_\-\/]*$/i;
const MAX_RETRY_AFTER_SECONDS = 86_400;

interface ClientRateLimitPayload {
  reason?: string;
  method?: string;
  path?: string;
  retryAfterSeconds?: number;
  captchaRequired?: boolean;
  surface?: string;
}

function cleanRetryAfter(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(MAX_RETRY_AFTER_SECONDS, Math.round(parsed)));
}

function clientIpFamily(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  if (forwarded.includes(":")) return "ipv6";
  if (forwarded.includes(".")) return "ipv4";
  return "unknown";
}

Deno.serve(withAuditWrapper("client-rate-limit-log", async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const requestId = crypto.randomUUID().slice(0, 8);

  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const contentLength = Number(req.headers.get("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > 2_000) {
      return new Response(JSON.stringify({ error: "Payload too large" }), {
        status: 413,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const payload = (await req.json()) as ClientRateLimitPayload;
    const reason = typeof payload.reason === "string" && VALID_REASONS.has(payload.reason) ? payload.reason : "request_throttle";
    const method = typeof payload.method === "string" && VALID_METHODS.has(payload.method.toUpperCase()) ? payload.method.toUpperCase() : "UNKNOWN";
    const path = typeof payload.path === "string" && PATH_RE.test(payload.path) ? payload.path : "/redacted";
    const retryAfterSeconds = cleanRetryAfter(payload.retryAfterSeconds);
    const surface = typeof payload.surface === "string" ? payload.surface.slice(0, 64) : "unknown";

    log.warn("client-rate-limit-hit", "Client-side rate limit blocked a request", {
      requestId,
      reason,
      method,
      path,
      retryAfterSeconds,
      captchaRequired: payload.captchaRequired === true,
      surface,
      ipFamily: clientIpFamily(req),
    });

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch (err) {
    log.warn("client-rate-limit-hit", "Invalid client rate-limit telemetry payload", { requestId }, err);
    return new Response(JSON.stringify({ error: "Bad request" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}));
