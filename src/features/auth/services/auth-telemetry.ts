import { supabase } from "@/integrations/supabase/client";
import { createLogger } from "@/services/logger.service";

const log = createLogger("auth-telemetry");

/**
 * auth-telemetry — typed writer for the auth FSM. Every state transition,
 * flow start, and flow outcome should call exactly one of these helpers
 * so the Auth Funnel dashboard (Phase 5) can replay any login from
 * `ops_events`.
 *
 * Beacons MUST be tagged `severity:info|warn` only — auth telemetry must
 * never reach the Triage queue (which is gated on `severity:error`).
 * Real errors go through `auth-failure-policy.beaconKind`, which the
 * policy guarantees is non-`severity:error`.
 *
 * Schema: ops_events { kind, actor_id, payload jsonb, severity, source_table }
 */

export type AuthBeaconKind =
  | "auth.signin.start"
  | "auth.signin.success"
  | "auth.signin.invalid_credentials"
  | "auth.signin.account_locked"
  | "auth.signin.rate_limited"
  | "auth.signin.captcha_required"
  | "auth.signin.captcha_failed"
  | "auth.signin.google_only"
  | "auth.signin.email_unconfirmed"
  | "auth.signin.client_session_write_failed"
  | "auth.signin.network_error"
  | "auth.signin.service_unavailable"
  | "auth.signin.unexpected"
  | "auth.signin.noop"
  | "auth.signup.start"
  | "auth.signup.verification_sent"
  | "auth.signup.email_provider_unverified"
  | "auth.signup.completed"
  | "auth.password.weak"
  | "auth.password.same"
  | "auth.reset.requested"
  | "auth.reset.completed"
  | "auth.reset.session_expired"
  | "auth.reset.link_consumed"
  | "auth.mfa.required"
  | "auth.mfa.invalid_code"
  | "auth.signout.success"
  | string; // permits future codes without bumping types

export interface AuthBeaconPayload {
  correlationId: string;
  route?: string;
  latencyMs?: number;
  outcome?: "ok" | "err";
  errorCode?: string;
  /** Reserved for opaque, non-PII details. NEVER include email/password/IP. */
  details?: Record<string, unknown>;
}

export async function emitAuthBeacon(
  kind: AuthBeaconKind,
  payload: AuthBeaconPayload,
  severity: "info" | "warn" = "info",
): Promise<void> {
  try {
    // record_event(sink, kind, actor, payload, severity, source_table)
    // ops_events sink keeps telemetry out of compliance audit_log.
    const { error } = await supabase.rpc("record_event" as never, {
      p_sink: "ops_events",
      p_kind: kind,
      p_actor: null,
      p_payload: payload as unknown as Record<string, unknown>,
      p_severity: severity,
      p_source_table: "features/auth",
    } as never);
    if (error) log.warn("emitAuthBeacon rpc failed", { kind, code: error.code });
  } catch (err) {
    // Telemetry is best-effort — must never throw into auth flow.
    log.warn("emitAuthBeacon threw", { kind, err: err instanceof Error ? err.message : String(err) });
  }
}

/** Generate a per-submit correlation id. UUIDv4-ish, crypto where available. */
export function newCorrelationId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch { /* fall through */ }
  // Fallback: time + random
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
