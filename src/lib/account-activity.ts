/**
 * Account-activity telemetry.
 *
 * Captures EVERY account-related action attempted from the client — even ones
 * that never reach Supabase Auth (rate-limit blocks, client-side validation
 * failures, network errors). Writes a row to `public.audit_log` via the
 * existing `write_audit_log` RPC so admins can diagnose issues like
 * "user can't sign up" without having to dig through browser sessions.
 *
 * Fire-and-forget: never throws, never blocks the UI.
 */
import { supabase } from "@/integrations/supabase/client";
import { redactText } from "@/lib/redact";

export type AccountActivity =
  | "signup_attempt_started"
  | "signup_validation_failed"
  | "signup_rate_limited"
  | "signup_supabase_error"
  | "signup_succeeded"
  | "signup_blocked_existing_account"
  | "signup_network_error"
  | "signup_indeterminate_timeout"
  | "signup_indeterminate_resolved_signed_in"
  | "signup_indeterminate_resolved_unconfirmed"
  | "signup_indeterminate_resolved_not_created"
  | "signup_indeterminate_probe_inconclusive"
  | "signup_confirmation_resend_requested"
  | "signup_confirmation_resend_failed"
  | "signup_confirmation_resend_succeeded"
  | "login_attempt_started"
  | "login_failed"
  | "login_succeeded"
  | "login_rate_limited"
  | "auth_captcha_failed"
  | "auth_captcha_fetch_blocked"
  | "password_reset_requested"
  | "password_reset_failed"
  | "password_reset_google_only_blocked"
  | "password_updated"
  | "signout_local"
  | "signout_global"
  | "signout_all_devices"
  | "session_revoked_serverside"
  | "invalid_refresh_token_cleared"
  | "session_idle_timeout"
  | "session_expired_clientside";

interface ActivityPayload {
  email?: string | null;
  userId?: string | null;
  errorMessage?: string | null;
  errorCode?: string | number | null;
  details?: Record<string, unknown>;
}

const EMAIL_VISIBLE_EVENTS = new Set<AccountActivity>([
  "password_reset_requested",
  "password_reset_failed",
  "password_reset_google_only_blocked",
]);

/** Hash an email so we never store raw PII in audit logs that admins query frequently. */
async function hashEmail(email: string): Promise<string> {
  try {
    const data = new TextEncoder().encode(email.toLowerCase().trim());
    const hash = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 16);
  } catch {
    return "hash_unavailable";
  }
}

export async function logAccountActivity(
  event: AccountActivity,
  payload: ActivityPayload = {}
): Promise<void> {
  try {
    const fields: string[] = [];
    if (payload.email) {
      const normalizedEmail = payload.email.toLowerCase().trim();
      if (EMAIL_VISIBLE_EVENTS.has(event)) fields.push(`attempted_email:${normalizedEmail}`);
      fields.push(`email_hash:${await hashEmail(normalizedEmail)}`);
    }
    if (payload.errorCode != null) fields.push(`code:${String(payload.errorCode)}`);
    if (payload.details) {
      for (const [k, v] of Object.entries(payload.details)) {
        const val = typeof v === "string" ? v : JSON.stringify(v);
        // Cap field length so an unbounded server message can't bloat the log.
        fields.push(`${k}:${val.slice(0, 200)}`);
      }
    }

    await supabase.rpc("write_audit_log", {
      p_event_type: event,
      p_table_name: "auth.users",
      p_record_id: null,
      p_user_id: payload.userId ?? null,
      p_changed_fields: fields.length ? fields : null,
      p_error_message: payload.errorMessage ? redactText(payload.errorMessage) : null,
    });
  } catch {
    // Telemetry must never break the user flow.
  }
}
