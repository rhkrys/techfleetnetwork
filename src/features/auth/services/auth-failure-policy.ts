import { type AuthErrorCode, assertNever } from "../domain/auth-codes";

/**
 * AuthFailurePolicy — the SINGLE module allowed to decide whether an auth
 * failure increments any counter or refreshes any CAPTCHA.
 *
 * Enforced by the `no-direct-failure-counters` ESLint rule: every call to
 * `record_failed_login`, `recordInvalidAuthAttempt`, `RateLimitService.recordFailure`,
 * or `recordFailedLoginAttempt` outside this file fails CI.
 *
 * VICHEA INVARIANT: `client_session_write_failed` MUST set every counter
 * flag to false. A client-side bug can never cause a device lockout or
 * server rate-limit hit. This invariant is locked by
 * `auth-failure-policy.contract.test.ts`.
 */
export interface FailureActions {
  /** Increment per-device login lockout (localStorage). */
  incrementDeviceLockout: boolean;
  /** Call `record_rate_limit_failure` RPC against server. */
  recordServerRateLimitFailure: boolean;
  /** Call `record_failed_login` RPC (legacy counter). */
  recordCredentialFailureRpc: boolean;
  /** Force a CAPTCHA refresh / re-verify. */
  refreshCaptcha: boolean;
  /** Beacon name written to ops_events.kind. */
  beaconKind: string;
  /** Toast i18n key surfaced to the user. */
  toastKey: string;
  /** Whether the user should be redirected to /forgot-password (lockout copy). */
  suggestReset: boolean;
}

export const NO_OP_FAILURE_ACTIONS: FailureActions = Object.freeze({
  incrementDeviceLockout: false,
  recordServerRateLimitFailure: false,
  recordCredentialFailureRpc: false,
  refreshCaptcha: false,
  beaconKind: "auth.signin.noop",
  toastKey: "auth.error.unexpected",
  suggestReset: false,
});

export function decideFailureActions(code: AuthErrorCode): FailureActions {
  switch (code) {
    case "invalid_credentials":
      return {
        incrementDeviceLockout: true,
        recordServerRateLimitFailure: true,
        recordCredentialFailureRpc: true,
        refreshCaptcha: false,
        beaconKind: "auth.signin.invalid_credentials",
        toastKey: "auth.error.invalid_credentials",
        suggestReset: false,
      };

    case "account_locked":
      // Already counted server-side — never re-increment locally.
      return {
        ...NO_OP_FAILURE_ACTIONS,
        beaconKind: "auth.signin.account_locked",
        toastKey: "auth.error.account_locked",
        suggestReset: true,
      };

    case "rate_limited":
      // Server already enforced. Local counters MUST NOT pile on.
      return {
        ...NO_OP_FAILURE_ACTIONS,
        beaconKind: "auth.signin.rate_limited",
        toastKey: "auth.error.rate_limited",
        suggestReset: false,
      };

    case "captcha_required":
      return {
        ...NO_OP_FAILURE_ACTIONS,
        refreshCaptcha: true,
        beaconKind: "auth.signin.captcha_required",
        toastKey: "auth.error.captcha_required",
      };

    case "captcha_failed":
      return {
        ...NO_OP_FAILURE_ACTIONS,
        refreshCaptcha: true,
        beaconKind: "auth.signin.captcha_failed",
        toastKey: "auth.error.captcha_failed",
      };

    case "google_only_account":
      return { ...NO_OP_FAILURE_ACTIONS, beaconKind: "auth.signin.google_only", toastKey: "auth.error.google_only_account" };

    case "email_not_confirmed":
      return { ...NO_OP_FAILURE_ACTIONS, beaconKind: "auth.signin.email_unconfirmed", toastKey: "auth.error.email_not_confirmed" };

    case "email_provider_unverified":
      return { ...NO_OP_FAILURE_ACTIONS, beaconKind: "auth.signup.email_provider_unverified", toastKey: "auth.error.email_provider_unverified" };

    case "weak_password":
      return { ...NO_OP_FAILURE_ACTIONS, beaconKind: "auth.password.weak", toastKey: "auth.error.weak_password" };

    case "same_password":
      return { ...NO_OP_FAILURE_ACTIONS, beaconKind: "auth.password.same", toastKey: "auth.error.same_password" };

    case "recovery_session_expired":
      return { ...NO_OP_FAILURE_ACTIONS, beaconKind: "auth.reset.session_expired", toastKey: "auth.error.recovery_session_expired" };

    case "recovery_link_consumed":
      return { ...NO_OP_FAILURE_ACTIONS, beaconKind: "auth.reset.link_consumed", toastKey: "auth.error.recovery_link_consumed" };

    case "mfa_required":
      return { ...NO_OP_FAILURE_ACTIONS, beaconKind: "auth.mfa.required", toastKey: "auth.mfa.required" };

    case "mfa_invalid_code":
      // MFA-specific counter only, never the credential counter.
      return {
        incrementDeviceLockout: false,
        recordServerRateLimitFailure: false,
        recordCredentialFailureRpc: false,
        refreshCaptcha: false,
        beaconKind: "auth.mfa.invalid_code",
        toastKey: "auth.error.mfa_invalid_code",
        suggestReset: false,
      };

    // === The Vichea branch + transport branches: explicitly non-punitive. ===
    case "client_session_write_failed":
      return { ...NO_OP_FAILURE_ACTIONS, beaconKind: "auth.signin.client_session_write_failed", toastKey: "auth.error.try_again" };

    case "network_error":
      return { ...NO_OP_FAILURE_ACTIONS, beaconKind: "auth.signin.network_error", toastKey: "auth.error.network" };

    case "service_unavailable":
      return { ...NO_OP_FAILURE_ACTIONS, beaconKind: "auth.signin.service_unavailable", toastKey: "auth.error.service_unavailable" };

    case "unexpected":
      return { ...NO_OP_FAILURE_ACTIONS, beaconKind: "auth.signin.unexpected", toastKey: "auth.error.unexpected" };

    default:
      return assertNever(code, "decideFailureActions");
  }
}
