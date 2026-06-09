import { type AuthResult, ok, err } from "../domain/auth-result";
import { classifyAuthErrorCode } from "../services/auth-classifier";
import { emitAuthBeacon, newCorrelationId } from "../services/auth-telemetry";
import { supabase } from "@/integrations/supabase/client";

/**
 * Typed sign-up flow. Returns `verification_email_sent` on success.
 *
 * Phase 5: direct GoTrue call; Phase 3 broker route adds HIBP +
 * disposable-email + DNS-MX checks and queues the confirmation row
 * transactionally through `application_confirmation_outbox`.
 */
export interface SignUpInput {
  email: string;
  password: string;
  emailRedirectTo?: string;
  metadata?: Record<string, unknown>;
  correlationId?: string;
}

export async function signUp(input: SignUpInput): Promise<AuthResult> {
  const correlationId = input.correlationId ?? newCorrelationId();
  await emitAuthBeacon("auth.signup.start", {
    correlationId,
    route: "signup.password",
  });

  try {
    const { error } = await supabase.auth.signUp({
      email: input.email,
      password: input.password,
      options: {
        emailRedirectTo:
          input.emailRedirectTo ?? `${window.location.origin}/`,
        data: input.metadata,
      },
    });

    if (error) {
      const code = classifyAuthErrorCode(error);
      await emitAuthBeacon("auth.signup.error", {
        correlationId,
        route: "signup.password",
        outcome: "err",
        errorCode: code,
      });
      return err({ code, correlationId });
    }

    await emitAuthBeacon("auth.signup.email_sent", {
      correlationId,
      route: "signup.password",
      outcome: "ok",
    });
    return ok({
      kind: "verification_email_sent",
      email: input.email,
      correlationId,
    });
  } catch (caught) {
    const code = classifyAuthErrorCode(caught);
    await emitAuthBeacon("auth.signup.error", {
      correlationId,
      route: "signup.password",
      outcome: "err",
      errorCode: code,
    });
    return err({ code, correlationId });
  }
}
