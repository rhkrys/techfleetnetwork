import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@4.3.6";
import { createEdgeLogger } from "../_shared/logger.ts";

// M-01: Lenient shape guard. Existing identifier/action checks below remain authoritative.
const BodySchema = z.object({
  identifier: z.unknown().optional(),
  action: z.unknown().optional(),
}).passthrough();

import { withAuditWrapper } from "../_shared/audit.ts";
const log = createEdgeLogger("rate-limit");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(withAuditWrapper("rate-limit", async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const requestId = crypto.randomUUID().substring(0, 8);
  log.info("handler", `Request received [${requestId}]`, { requestId });

  try {
    const rawBody = await req.json().catch(() => ({}));
    const parsedBody = BodySchema.safeParse(rawBody);
    if (!parsedBody.success) {
      return new Response(
        JSON.stringify({ error: "Invalid body" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const { identifier, action } = parsedBody.data as { identifier?: unknown; action?: unknown };

    const VALID_ACTIONS = ["login_attempt", "signup_attempt", "signup_resend", "password_reset", "identity_check"];
    if (!identifier || typeof identifier !== "string" || identifier.length > 255) {
      log.warn("validate", `Invalid identifier [${requestId}]: type=${typeof identifier}, length=${identifier?.length}`, { requestId });
      return new Response(
        JSON.stringify({ error: "Invalid identifier" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (!action || !VALID_ACTIONS.includes(action)) {
      log.warn("validate", `Invalid action "${action}" [${requestId}] — allowed: ${VALID_ACTIONS.join(", ")}`, { requestId, action });
      return new Response(
        JSON.stringify({ error: "Invalid action" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    log.info("check", `Checking rate limit for action "${action}" [${requestId}]`, { requestId, action });

    const encoder = new TextEncoder();
    const data = encoder.encode(identifier + Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashedIdentifier = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: result, error } = await supabase.rpc("check_rate_limit", {
      p_identifier: hashedIdentifier,
      p_action: action,
      p_max_attempts: action === "login_attempt" ? 6 : action === "identity_check" ? 10 : 3,
      p_window_minutes: 15,
      p_block_minutes: action === "identity_check" ? 5 : 60,
    });

    if (error) {
      log.error("check", `Rate limit RPC failed [${requestId}]: ${error.message} — failing open`, { requestId, action }, error);
      return new Response(
        JSON.stringify({ allowed: true, remaining: 0, retry_after: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!result.allowed) {
      log.warn("check", `Rate limit exceeded [${requestId}]: action="${action}", retryAfter=${result.retry_after}s`, {
        requestId,
        action,
        allowed: result.allowed,
        remaining: result.remaining,
        retryAfter: result.retry_after,
      });
    } else {
      log.info("check", `Rate limit OK [${requestId}]: action="${action}", remaining=${result.remaining}`, {
        requestId,
        action,
        remaining: result.remaining,
      });
    }

    const statusCode = 200;
    return new Response(JSON.stringify(result), {
      status: statusCode,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        ...(result.retry_after > 0 && { "Retry-After": String(result.retry_after) }),
      },
    });
  } catch (err) {
    log.error("handler", `Unhandled exception [${requestId}]`, { requestId }, err);
    return new Response(
      JSON.stringify({ error: "Bad request" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}));
