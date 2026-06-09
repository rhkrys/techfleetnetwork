import { describe, expect, it } from "vitest";
import { AUTH_ERROR_CODES, type AuthErrorCode } from "../../domain/auth-codes";
import { decideFailureActions } from "../../services/auth-failure-policy";

describe("AuthFailurePolicy contract", () => {
  it("declares actions for every AuthErrorCode (exhaustive)", () => {
    for (const code of AUTH_ERROR_CODES) {
      expect(() => decideFailureActions(code)).not.toThrow();
    }
  });

  // VICHEA INVARIANT — must never regress.
  const NON_PUNITIVE: AuthErrorCode[] = [
    "client_session_write_failed",
    "network_error",
    "service_unavailable",
    "unexpected",
  ];
  it.each(NON_PUNITIVE)("non-punitive: %s fires zero counters", (code) => {
    const a = decideFailureActions(code);
    expect(a.incrementDeviceLockout).toBe(false);
    expect(a.recordServerRateLimitFailure).toBe(false);
    expect(a.recordCredentialFailureRpc).toBe(false);
  });

  it("only invalid_credentials fires the credential counter", () => {
    for (const code of AUTH_ERROR_CODES) {
      const a = decideFailureActions(code);
      if (code === "invalid_credentials") {
        expect(a.recordCredentialFailureRpc).toBe(true);
      } else {
        expect(a.recordCredentialFailureRpc).toBe(false);
      }
    }
  });

  it("only invalid_credentials increments the device lockout", () => {
    for (const code of AUTH_ERROR_CODES) {
      const a = decideFailureActions(code);
      if (code === "invalid_credentials") {
        expect(a.incrementDeviceLockout).toBe(true);
      } else {
        expect(a.incrementDeviceLockout).toBe(false);
      }
    }
  });

  it("rate_limited and account_locked never re-increment client counters", () => {
    for (const code of ["rate_limited", "account_locked"] as AuthErrorCode[]) {
      const a = decideFailureActions(code);
      expect(a.incrementDeviceLockout).toBe(false);
      expect(a.recordServerRateLimitFailure).toBe(false);
      expect(a.recordCredentialFailureRpc).toBe(false);
    }
  });

  it("captcha_failed only refreshes captcha", () => {
    const a = decideFailureActions("captcha_failed");
    expect(a.refreshCaptcha).toBe(true);
    expect(a.recordCredentialFailureRpc).toBe(false);
    expect(a.incrementDeviceLockout).toBe(false);
  });
});
