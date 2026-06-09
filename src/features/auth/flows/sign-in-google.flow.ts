import { type AuthResult, ok, err } from "../domain/auth-result";
import { classifyAuthErrorCode } from "../services/auth-classifier";
import { emitAuthBeacon, newCorrelationId } from "../services/auth-telemetry";
import { supabase } from "@/integrations/supabase/client";

/**
 * Typed sign-in-with-google flow. Triggers the OAuth redirect; the
 * machine treats this as a terminal `redirecting_to_provider` ok value.
 *
 * Phase 5: still uses `supabase.auth.signInWithOAuth` directly (the
 * OAuth broker dance is unchanged and works). Phase 3 callback handling
 * routes through `auth-broker/sign-in/google-callback` when ready.
 */
export interface SignInGoogleInput {
  redirectTo?: string;
  correlationId?: string;
}

export async function signInWithGoogle(input: SignInGoogleInput = {}): Promise<AuthResult> {
  const correlationId = input.correlationId ?? newCorrelationId();
  await emitAuthBeacon("auth.signin.start", { correlationId, route: "signin.google" });

  try {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: input.redirectTo ?? `${window.location.origin}/`,
      },
    });

    if (error) {
      const code = classifyAuthErrorCode(error);
      await emitAuthBeacon("auth.signin.error", {
        correlationId,
        route: "signin.google",
        outcome: "err",
        errorCode: code,
      });
      return err({ code, correlationId });
    }

    return ok({ kind: "redirecting_to_provider", provider: "google", correlationId });
  } catch (caught) {
    const code = classifyAuthErrorCode(caught);
    await emitAuthBeacon("auth.signin.error", {
      correlationId,
      route: "signin.google",
      outcome: "err",
      errorCode: code,
    });
    return err({ code, correlationId });
  }
}
