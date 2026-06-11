import { type AuthResult, ok, err } from "../domain/auth-result";
import { classifyAuthErrorCode } from "../services/auth-classifier";
import { decideFailureActions } from "../services/auth-failure-policy";
import { emitAuthBeacon, newCorrelationId } from "../services/auth-telemetry";
import { AuthService } from "@/services/auth.service";

/**
 * Typed sign-in-with-password flow. Single entry point for the UI:
 * returns `Result<AuthOk, AuthErr>` — no throws cross this boundary.
 *
 * AUTH-DIRECT-SIGNIN-001 (2026-06-11): routes through
 * `AuthService.signInWithPassword`, which uses the auth SDK as the sole
 * password-session owner. The removed edge-token handoff cannot re-enter the
 * active login path.
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


