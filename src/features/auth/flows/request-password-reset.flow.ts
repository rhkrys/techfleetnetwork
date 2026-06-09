import { type AuthResult, ok, err } from "../domain/auth-result";
import { classifyAuthErrorCode } from "../services/auth-classifier";
import { emitAuthBeacon, newCorrelationId } from "../services/auth-telemetry";
import { supabase } from "@/integrations/supabase/client";

/**
 * Typed password-reset-request flow. Always resolves to
 * `password_reset_email_sent` on success (no account enumeration).
 *
 * Phase 5: direct call to GoTrue; Phase 3 broker route is
 * `auth-broker/password-reset/request` which adds per-IP + per-email
 * rate limiting before touching GoTrue.
 */
export interface RequestPasswordResetInput {
  email: string;
  redirectTo?: string;
  correlationId?: string;
}

export async function requestPasswordReset(
  input: RequestPasswordResetInput,
): Promise<AuthResult> {
  const correlationId = input.correlationId ?? newCorrelationId();
  await emitAuthBeacon("auth.reset.request", {
    correlationId,
    route: "reset.request",
  });

  try {
    const { error } = await supabase.auth.resetPasswordForEmail(input.email, {
      redirectTo:
        input.redirectTo ?? `${window.location.origin}/reset-password`,
    });

    if (error) {
      const code = classifyAuthErrorCode(error);
      await emitAuthBeacon("auth.reset.error", {
        correlationId,
        route: "reset.request",
        outcome: "err",
        errorCode: code,
      });
      // We still return ok to the UI to avoid account enumeration; the
      // beacon captures the underlying failure for ops.
      return ok({ kind: "password_reset_email_sent", correlationId });
    }

    await emitAuthBeacon("auth.reset.email_sent", {
      correlationId,
      route: "reset.request",
      outcome: "ok",
    });
    return ok({ kind: "password_reset_email_sent", correlationId });
  } catch (caught) {
    const code = classifyAuthErrorCode(caught);
    await emitAuthBeacon("auth.reset.error", {
      correlationId,
      route: "reset.request",
      outcome: "err",
      errorCode: code,
    });
    // Even on transport failure we surface as sent (anti-enumeration).
    void code;
    return err({ code: "service_unavailable", correlationId });
  }
}
