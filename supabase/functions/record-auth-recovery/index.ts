// @edge-auth
// supabase/functions/record-auth-recovery/index.ts
//
// Public-by-design beacon for password-reset / recovery telemetry. The whole
// point of this endpoint is that it works WHEN the user has no valid auth
// session — that's precisely when reset bugs happen and when prior
// diagnostics (write_audit_log) silently failed because they required auth.
//
// Hardened:
//  - Strict enum allow-lists on branch + outcome.
//  - 4KB body cap.
//  - Per-IP rate limit (60/hr) to bound abuse.
//  - Daily-salted IP hash (no raw IPs stored).
//  - No tokens, emails, passwords, or full URLs accepted. Only booleans
//    describing the URL shape, plus the branch + outcome enum.
//  - Writes to ops_events via record_event RPC (telemetry sink, 90d retention).
//
// Reference: docs/runbooks/password-reset-permanent-fix.md

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { withAuditWrapper } from "../_shared/audit.ts";

const ALLOWED_BRANCHES = new Set([
  "token_hash",
  "code",
  "hash",
  "session_event",
  "no_params",
  "timeout",
  "update_submit",
]);

const ALLOWED_OUTCOMES = new Set([
  "ok",
  "no_session_returned",
  "verify_error",
  "exchange_error",
  "set_session_error",
  "get_user_error",
  "update_session_expired",
  "update_service_unavailable",
  "update_rate_limited",
  "update_same_password",
  "update_weak_password",
  "update_unknown_error",
  "update_success",
  "missing_proof_blocked",
  // AUTH-RESET-007: emitted when verifyOtp returns an error AND we hold no
  // recovery session — strong fingerprint of an upstream link prefetcher
  // (SafeLinks / Proofpoint / Slack unfurler / AV scanner) consuming the
  // single-use token before the human ever clicked Continue.
  "recovery_link_prefetch_suspected",
]);

const RATE_LIMIT_MAX = 60;
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
  const data = new TextEncoder().encode(`${ip}|${day}|tfn_reset_salt_v1`);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

function corsFor(req: Request): HeadersInit {
  const origin = req.headers.get("origin") ?? "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-trace-id, x-request-id",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

Deno.serve(
  withAuditWrapper("record-auth-recovery", async (req: Request) => {
    const cors = corsFor(req);
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    if (req.method !== "POST") {
      return new Response(null, { status: 204, headers: cors });
    }

    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("cf-connecting-ip") ||
      "unknown";
    if (rateLimited(ip)) {
      // 204 so beacon failures never bubble to the user.
      return new Response(null, { status: 204, headers: cors });
    }

    let raw = "";
    try {
      raw = await req.text();
    } catch {
      return new Response(null, { status: 204, headers: cors });
    }
    if (raw.length > 4 * 1024) {
      return new Response(null, { status: 204, headers: cors });
    }

    let body: Record<string, unknown> = {};
    try {
      body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    } catch {
      return new Response(null, { status: 204, headers: cors });
    }

    const branch = String(body.branch ?? "");
    const outcome = String(body.outcome ?? "");
    if (!ALLOWED_BRANCHES.has(branch) || !ALLOWED_OUTCOMES.has(outcome)) {
      return new Response(null, { status: 204, headers: cors });
    }

    const has_token_hash = body.has_token_hash === true;
    const has_code = body.has_code === true;
    const has_hash = body.has_hash === true;
    const token_hash_prefix =
      typeof body.token_hash_prefix === "string"
        ? body.token_hash_prefix.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 24)
        : null;
    const release_tag = typeof body.release_tag === "string" ? body.release_tag.slice(0, 64) : null;
    const user_agent = (req.headers.get("user-agent") ?? "").slice(0, 256);
    const ip_hash = await hashIp(ip);

    const severity =
      outcome === "update_success" || outcome === "ok"
        ? "info"
        : outcome === "recovery_link_prefetch_suspected"
          ? "warn"
          : outcome === "update_service_unavailable" || outcome === "update_rate_limited"
            ? "warn"
            : "info";

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    try {
      await supabase.rpc("record_event", {
        p_sink: "ops_events",
        p_kind: `auth.recovery.${branch}.${outcome}`,
        p_actor: null,
        p_payload: {
          branch,
          outcome,
          has_token_hash,
          has_code,
          has_hash,
          token_hash_prefix,
          release_tag,
          user_agent,
          ip_hash,
        },
        p_severity: severity,
        p_ref_table: "auth.users",
        p_ref_id: null,
      });
    } catch (err) {
      console.warn("record-auth-recovery insert failed", String(err));
    }

    return new Response(null, { status: 204, headers: cors });
  })
);
