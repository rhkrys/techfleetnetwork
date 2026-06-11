import { type AuthResult, ok, err } from "../domain/auth-result";
import { classifyAuthErrorCode } from "../services/auth-classifier";
import { setSessionSafe } from "../services/auth-flow.service";
import { decideFailureActions } from "../services/auth-failure-policy";
import { emitAuthBeacon, newCorrelationId } from "../services/auth-telemetry";
import { AuthService } from "@/services/auth.service";

/**
 * Typed sign-in-with-password flow. Single entry point for the UI:
 * returns `Result<AuthOk, AuthErr>` — no throws cross this boundary.
 *
 * Phase 2 (Vichea re-code 2026-06-11): routes through `AuthService.signInWithPassword`
 * which calls the `login-with-captcha` edge function. Preserves the server-side
 * CAPTCHA gate, throttle protection, and audit logging while exposing a typed
 * code-first contract to the UI. The legacy LoginPage submit path can switch
 * to this flow without losing the server CAPTCHA gate.
 */
export interface SignInPasswordInput {
  email: string;
  password: string;
  captchaToken?: string;
  attemptId?: string;
  correlationId?: string;
}

export async function signInWithPassword(input: SignInPasswordInput): Promise<AuthResult> {
  const correlationId = input.correlationId ?? newCorrelationId();
  const startedAt = Date.now();

  await emitAuthBeacon("auth.signin.start", { correlationId, route: "signin.password" });

  try {
    const data = await AuthService.signInWithPassword(
      input.email,
      input.password,
      input.captchaToken ?? "",
      input.attemptId,
    );
    await emitAuthBeacon("auth.signin.success", {
      correlationId,
      route: "signin.password",
      latencyMs: Date.now() - startedAt,
      outcome: "ok",
    });
    return ok({ kind: "signed_in", userId: data?.user?.id ?? "", correlationId });
  } catch (caught) {
    const code = classifyAuthErrorCode(caught);
    const actions = decideFailureActions(code);
    await emitAuthBeacon(actions.beaconKind, {
      correlationId,
      route: "signin.password",
      latencyMs: Date.now() - startedAt,
      outcome: "err",
      errorCode: code,
    });
    return err({ code, correlationId });
  }
}

// Re-export so the future broker swap stays internal to this module.
export { setSessionSafe };

