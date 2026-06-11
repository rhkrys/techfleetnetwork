/**
 * AUTH-ENGINE — failure policy (canonical location per Ship 1).
 *
 * Re-exports the existing `auth-failure-policy` decision table AND owns the
 * three punitive counter channels (device lockout, captcha failure, server
 * rate-limit + credential-failure RPC). All engine code MUST funnel counter
 * mutations through these helpers so the Vichea invariant ("client_session_
 * write_failed touches no counter") is enforced in one file.
 *
 * The legacy module under `src/features/auth/services/auth-failure-policy.ts`
 * stays in place as the decision table until Ship 5 collapses both into one
 * file.
 *
 * VICHEA INVARIANT: `client_session_write_failed` MUST set every counter flag
 * to false. Verified by `auth-failure-policy.contract.test.ts`. Do not bypass.
 */
import { recordInvalidAuthAttempt, type AuthLockoutState } from "@/features/auth/ports/lockout.port";
import { recordFailedLoginAttempt, type LoginCaptchaState } from "@/features/auth/ports/captcha-state.port";
import { RateLimitService } from "@/services/rate-limit.service";
import { sessionPort } from "@/features/auth/ports/session.port";

export {
  decideFailureActions,
  type FailureActions,
} from "@/features/auth/services/auth-failure-policy";

/** Punitive: advance device-lockout counter and return next state. */
export function applyInvalidAttempt(): AuthLockoutState {
  return recordInvalidAuthAttempt();
}

/** Punitive: advance the captcha failure counter (login surface). */
export function applyCaptchaFailedLogin(): LoginCaptchaState {
  return recordFailedLoginAttempt();
}

/** Punitive: record a server-side rate-limit failure (fire-and-forget). */
export function applyServerRateLimitFailure(email: string, purpose: string): void {
  void RateLimitService.recordFailure(email, purpose).catch(() => undefined);
}

/** Punitive: record the credential-failure RPC for cross-device lockout. */
export function applyCredentialFailureRpc(email: string, userAgent: string): void {
  void (async () => {
    await sessionPort.rpc("record_failed_login", {
      _email: email,
      _ip: null,
      _user_agent: userAgent.substring(0, 200),
    });
  })().catch(() => undefined);
}
