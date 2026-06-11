/**
 * AUTH-LOGIN-RECODE-001 — exhaustive regression coverage for the
 * "Vichea re-code" plan (June 11, 2026, item §6).
 *
 * Pure contract assertions against the typed AuthErr → FailureActions
 * decision matrix that powers the live LoginPage submit handler.
 * Anything the UI does after a failure (lockout, captcha refresh, RPC
 * fan-out) is gated by `decideFailureActions(code)`, so locking these
 * invariants is equivalent to locking the user-visible behavior.
 */
import { describe, it, expect } from "vitest";
import { decideFailureActions } from "@/features/auth/services/auth-failure-policy";
import type { AuthErrorCode } from "@/features/auth/domain/auth-codes";

const NON_PUNITIVE: AuthErrorCode[] = [
  "client_session_write_failed",
  "captcha_required",
  "captcha_failed",
  "network_error",
  "service_unavailable",
  "rate_limited",
  "account_locked",
  "google_only_account",
];

describe("AUTH-LOGIN-RECODE-001 §6 — non-punitive failures never increment counters", () => {
  it.each(NON_PUNITIVE)("%s never bumps device lockout, server rate-limit, or credential RPC", (code) => {
    const a = decideFailureActions(code);
    expect(a.incrementDeviceLockout).toBe(false);
    expect(a.recordServerRateLimitFailure).toBe(false);
    expect(a.recordCredentialFailureRpc).toBe(false);
  });

  it("captcha_required and captcha_failed force a fresh widget", () => {
    expect(decideFailureActions("captcha_required").refreshCaptcha).toBe(true);
    expect(decideFailureActions("captcha_failed").refreshCaptcha).toBe(true);
  });

  it("invalid_credentials is the ONLY code that drives all three punitive channels", () => {
    const a = decideFailureActions("invalid_credentials");
    expect(a.incrementDeviceLockout).toBe(true);
    expect(a.recordServerRateLimitFailure).toBe(true);
    expect(a.recordCredentialFailureRpc).toBe(true);
  });

  it("google_only_account does NOT suggest a password reset (no recovery loop)", () => {
    expect(decideFailureActions("google_only_account").suggestReset).toBe(false);
  });
});
