import { describe, expect, it } from "vitest";
import { AUTH_ERROR_CODES, type AuthErrorCode } from "../../domain/auth-codes";
import { decideFailureActions } from "../auth-failure-policy";

/**
 * Contract test: locks down the Vichea + non-credential invariant.
 *
 * For every AuthErrorCode that is NOT `invalid_credentials`, the policy
 * MUST NOT call the credential counter RPC. This is the structural fix
 * for the bug where a client-side session-write failure was misclassified
 * as a bad password and inflated lockout counters.
 *
 * If a new code is added to AUTH_ERROR_CODES, this test forces the author
 * to consciously declare its counter posture.
 */

const NON_CREDENTIAL_CODES: AuthErrorCode[] = AUTH_ERROR_CODES.filter(
  (c) => c !== "invalid_credentials",
);

describe("auth-failure-policy contract", () => {
  it("invalid_credentials is the only code that fires the credential counter", () => {
    expect(decideFailureActions("invalid_credentials").recordCredentialFailureRpc).toBe(true);
    for (const code of NON_CREDENTIAL_CODES) {
      const actions = decideFailureActions(code);
      expect(actions.recordCredentialFailureRpc, `${code} must not fire credential counter`).toBe(false);
    }
  });

  it("client_session_write_failed is fully non-punitive (Vichea invariant)", () => {
    const a = decideFailureActions("client_session_write_failed");
    expect(a.incrementDeviceLockout).toBe(false);
    expect(a.recordServerRateLimitFailure).toBe(false);
    expect(a.recordCredentialFailureRpc).toBe(false);
    expect(a.refreshCaptcha).toBe(false);
    expect(a.suggestReset).toBe(false);
  });

  it("transport-class codes never punish the user", () => {
    for (const code of ["network_error", "service_unavailable", "unexpected"] as const) {
      const a = decideFailureActions(code);
      expect(a.incrementDeviceLockout).toBe(false);
      expect(a.recordServerRateLimitFailure).toBe(false);
      expect(a.recordCredentialFailureRpc).toBe(false);
    }
  });

  it("server-counted codes (rate_limited, account_locked) never double-count locally", () => {
    for (const code of ["rate_limited", "account_locked"] as const) {
      const a = decideFailureActions(code);
      expect(a.incrementDeviceLockout).toBe(false);
      expect(a.recordServerRateLimitFailure).toBe(false);
      expect(a.recordCredentialFailureRpc).toBe(false);
    }
  });

  it("captcha codes only trigger a captcha refresh, never counters", () => {
    for (const code of ["captcha_required", "captcha_failed"] as const) {
      const a = decideFailureActions(code);
      expect(a.refreshCaptcha).toBe(true);
      expect(a.recordCredentialFailureRpc).toBe(false);
      expect(a.incrementDeviceLockout).toBe(false);
    }
  });

  it("mfa_invalid_code never escalates into the credential counter", () => {
    const a = decideFailureActions("mfa_invalid_code");
    expect(a.recordCredentialFailureRpc).toBe(false);
    expect(a.incrementDeviceLockout).toBe(false);
  });

  it("every code emits a stable beacon kind for ops_events", () => {
    const seen = new Set<string>();
    for (const code of AUTH_ERROR_CODES) {
      const a = decideFailureActions(code);
      expect(a.beaconKind.length).toBeGreaterThan(0);
      seen.add(a.beaconKind);
    }
    // Every code should map to a unique beacon kind so the Auth Funnel
    // dashboard can attribute drop-offs without collisions.
    expect(seen.size).toBe(AUTH_ERROR_CODES.length);
  });
});
