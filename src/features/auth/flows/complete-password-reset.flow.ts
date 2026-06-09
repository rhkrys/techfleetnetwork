import { type AuthResult, ok, err } from "../domain/auth-result";
import { classifyAuthErrorCode } from "../services/auth-classifier";
import { emitAuthBeacon, newCorrelationId } from "../services/auth-telemetry";
import { supabase } from "@/integrations/supabase/client";

/**
 * Typed password-reset-complete flow. Called from `/reset-password`
 * after GoTrue has placed the user into a recovery session.
 *
 * Phase 5: direct `supabase.auth.updateUser({ password })` call.
 * Phase 3 broker route wraps this with `withIdempotency(recovery_token)`
 * so a double-click cannot consume the recovery link twice
 * (`recovery_link_consumed` replay).
 */
export interface CompletePasswordResetInput {
  newPassword: string;
  correlationId?: string;
}

export async function completePasswordReset(
  input: CompletePasswordResetInput,
): Promise<AuthResult> {
  const correlationId = input.correlationId ?? newCorrelationId();
  await emitAuthBeacon("auth.reset.complete.start", {
    correlationId,
    route: "reset.complete",
  });

  try {
    const { error } = await supabase.auth.updateUser({
      password: input.newPassword,
    });

    if (error) {
      const code = classifyAuthErrorCode(error);
      await emitAuthBeacon("auth.reset.complete.error", {
        correlationId,
        route: "reset.complete",
        outcome: "err",
        errorCode: code,
      });
      return err({ code, correlationId });
    }

    await emitAuthBeacon("auth.reset.complete.success", {
      correlationId,
      route: "reset.complete",
      outcome: "ok",
    });
    return ok({ kind: "password_updated", correlationId });
  } catch (caught) {
    const code = classifyAuthErrorCode(caught);
    await emitAuthBeacon("auth.reset.complete.error", {
      correlationId,
      route: "reset.complete",
      outcome: "err",
      errorCode: code,
    });
    return err({ code, correlationId });
  }
}
