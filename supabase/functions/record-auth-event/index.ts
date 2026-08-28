// @edge-public
// AUTH-ENGINE Ship 6: client telemetry sink for `auth_engine.*` ops_events.
//
// The auth screens fire state-transition pings (started/succeeded/failed,
// captcha_failed/reset, reset_succeeded, etc.) so the soak runbook queries
// in docs/runbooks/auth-rebuild-soak.md can verify zero regressions of the
// three bug classes that motivated the rebuild.
//
// verify_jwt = false because `started`/`captcha_failed` fire before a
// session exists. Guarded by a strict `kind` allowlist + payload size cap.
// All rows land in ops_events at severity=info (never reaches Triage).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { handleCors, jsonResponse, methodNotAllowed } from "../_shared/http.ts";
import { withAuditWrapper } from "../_shared/audit.ts";

const ALLOWED_KINDS = new Set<string>([
  "auth_engine.sign_in_started",
  "auth_engine.sign_in_succeeded",
  "auth_engine.sign_in_failed",
  "auth_engine.sign_in_blocked",
  "auth_engine.client_session_write_failed",
  "auth_engine.captcha_failed",
  "auth_engine.captcha_reset",
  "auth_engine.mfa_required",
  "auth_engine.sign_up_started",
  "auth_engine.sign_up_succeeded",
  "auth_engine.sign_up_failed",
  "auth_engine.forgot_started",
  "auth_engine.forgot_succeeded",
  "auth_engine.forgot_failed",
  // AUTH-ARCH-CUTOVER-003 — typed forgot-password outcomes so anti-enumeration
  // UI copy stays intact while ops gets distinct evidence of upstream failures.
  "auth_engine.forgot_accepted",
  "auth_engine.forgot_email_delivery_unverified",
  "auth_engine.forgot_rate_limited",
  "auth_engine.forgot_google_only_blocked",
  "auth_engine.forgot_validation_rejected",
  "auth_engine.reset_started",
  "auth_engine.reset_succeeded",
  "auth_engine.reset_failed",
  // AUTH-ARCH-CUTOVER-011 — typed resend-confirmation delivery outcome.
  "auth_engine.resend_confirmation_email_delivery_unverified",
  "auth_engine.bad_jwt_transient",
]);

const MAX_PAYLOAD_BYTES = 1024;

interface Body {
  kind?: string;
  payload?: Record<string, unknown>;
  actor?: string | null;
}

Deno.serve(
  withAuditWrapper("record-auth-event", async (req) => {
    const cors = handleCors(req);
    if (cors) return cors;
    if (req.method !== "POST") return methodNotAllowed();

    let body: Body;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "invalid_json" }, 400);
    }

    const kind = typeof body.kind === "string" ? body.kind : "";
    if (!ALLOWED_KINDS.has(kind)) return jsonResponse({ error: "kind_not_allowed" }, 400);

    const payload = (
      body.payload && typeof body.payload === "object" ? body.payload : {}
    ) as Record<string, unknown>;
    const serialized = JSON.stringify(payload);
    if (serialized.length > MAX_PAYLOAD_BYTES)
      return jsonResponse({ error: "payload_too_large" }, 413);

    const actor =
      typeof body.actor === "string" && /^[0-9a-f-]{36}$/i.test(body.actor) ? body.actor : null;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    const { error } = await admin.rpc("record_event", {
      p_sink: "ops_events",
      p_kind: kind,
      p_actor: actor,
      p_payload: payload,
      p_severity: "info",
      p_ref_table: null,
      p_ref_id: null,
    });
    if (error) {
      console.error("[record-auth-event] write_audit_log failed:", error);
      return jsonResponse({ error: "record_failed" }, 500);
    }
    return jsonResponse({ ok: true });
  })
);
