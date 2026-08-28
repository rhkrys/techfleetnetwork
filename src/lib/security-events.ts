/**
 * OWASP-aligned event vocabulary helper.
 *
 * Wraps `write_audit_log` with prefixes drawn from the OWASP Logging Vocabulary
 * cheat sheet so log queries are predictable across the platform.
 *
 *   authn_*           authentication events (login, MFA)
 *   authz_*           authorization decisions (admin gate, RLS denials)
 *   excess_*          rate-limit, abuse-throttle, brute-force lockouts
 *   input_validation_* zod failures, sanitizer drops, malformed payloads
 *   sensitive_*       PII access, exports, account deletion
 *   sys_*             configuration changes, key rotation, deploys
 *   malicious_*       confirmed attack patterns (prompt injection, SSRF probe)
 */
import { supabase } from "@/integrations/supabase/client";
import { redactText } from "@/lib/redact";

export type SecurityEvent =
  | "authn_login_success"
  | "authn_login_failure"
  | "authn_mfa_challenge"
  | "authn_mfa_success"
  | "authn_mfa_failure"
  | "authn_2fa_verified"
  | "authn_session_revoked"
  | "authz_admin_granted"
  | "authz_admin_denied"
  | "authz_role_change"
  | "excess_rate_limited"
  | "excess_account_locked"
  | "input_validation_failed"
  | "input_validation_html_sanitized"
  | "sensitive_pii_accessed"
  | "sensitive_data_exported"
  | "sensitive_account_deleted"
  | "sys_config_changed"
  | "sys_key_rotated"
  | "malicious_prompt_injection"
  | "malicious_ssrf_probe"
  | "malicious_path_traversal";

export interface SecurityEventPayload {
  event: SecurityEvent;
  table: string;
  recordId?: string | null;
  userId?: string | null;
  details?: string[];
  errorMessage?: string;
}

/**
 * Fire-and-forget audit write. Never throws — security telemetry must not
 * disrupt user flows.
 */
export async function logSecurityEvent(payload: SecurityEventPayload): Promise<void> {
  try {
    await supabase.rpc("write_audit_log", {
      p_event_type: payload.event,
      p_table_name: payload.table,
      p_record_id: payload.recordId ?? null,
      p_user_id: payload.userId ?? null,
      p_changed_fields: payload.details ?? null,
      p_error_message: payload.errorMessage ? redactText(payload.errorMessage) : null,
    });
  } catch {
    // Telemetry must never block UX.
  }
}
