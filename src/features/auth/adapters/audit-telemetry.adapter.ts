/**
 * AUTH-ENGINE Ship 6 — audit telemetry adapter.
 *
 * Single fire-and-forget seam between auth engines and ops_events. Engines
 * call `recordAuthEngineEvent(kind, payload)`; this adapter posts to the
 * `record-auth-event` edge function which validates the kind allowlist and
 * writes via `record_event(sink='ops_events', severity='info')`.
 *
 * Failures never throw — telemetry must never block sign-in.
 */
import { supabase } from "@/integrations/supabase/client";

export type AuthEngineKind =
  | "auth_engine.sign_in_started"
  | "auth_engine.sign_in_succeeded"
  | "auth_engine.sign_in_failed"
  | "auth_engine.sign_in_blocked"
  | "auth_engine.client_session_write_failed"
  | "auth_engine.captcha_failed"
  | "auth_engine.captcha_reset"
  | "auth_engine.mfa_required"
  | "auth_engine.sign_up_started"
  | "auth_engine.sign_up_succeeded"
  | "auth_engine.sign_up_failed"
  | "auth_engine.forgot_started"
  | "auth_engine.forgot_succeeded"
  | "auth_engine.forgot_failed"
  | "auth_engine.reset_started"
  | "auth_engine.reset_succeeded"
  | "auth_engine.reset_failed"
  | "auth_engine.bad_jwt_transient";

export function recordAuthEngineEvent(
  kind: AuthEngineKind,
  payload: Record<string, unknown> = {},
  actor: string | null = null,
): void {
  // Fire-and-forget — never await, never throw.
  try {
    void supabase.functions
      .invoke("record-auth-event", { body: { kind, payload, actor } })
      .catch(() => undefined);
  } catch {
    /* swallow — telemetry must never break auth */
  }
}
