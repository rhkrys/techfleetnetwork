/**
 * Locks the regression for issue #3 (MFA broken — challenge 504s, verify
 * 422s on valid codes). `challengeAndVerifyResilient` must:
 *
 *  - Retry exactly once on a transient 504 from GoTrue and succeed with
 *    the same user-supplied code (no extra typing required).
 *  - NEVER retry on 422 "Invalid TOTP code entered" — that path must
 *    propagate immediately as `MfaInvalidCodeError` so we don't burn the
 *    user's TOTP rate-limit on a genuinely wrong code.
 *  - Throw `MfaTransientError` (not `MfaInvalidCodeError`) when the GoTrue
 *    endpoint persistently 504s — the UI keeps the typed digits.
 *
 * BDD: AUTH-MFA-RESILIENT-504-001, AUTH-MFA-422-NO-RETRY-001
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockChallengeAndVerify, mockSetSession } = vi.hoisted(() => ({
  mockChallengeAndVerify: vi.fn(),
  mockSetSession: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      mfa: { challengeAndVerify: (...args: unknown[]) => mockChallengeAndVerify(...args) },
      setSession: (...args: unknown[]) => mockSetSession(...args),
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
    },
  },
}));

vi.mock("@/lib/auth/session-port", () => ({
  setSessionSafe: (...args: unknown[]) => mockSetSession(...args),
  getSessionSafe: vi.fn().mockResolvedValue(null),
}));

import { MfaService, MfaInvalidCodeError, MfaTransientError } from "@/services/mfa.service";

describe("MfaService.challengeAndVerifyResilient (AUTH-MFA-*)", () => {
  beforeEach(() => {
    mockChallengeAndVerify.mockReset();
    mockSetSession.mockReset();
    mockSetSession.mockResolvedValue({ data: { session: {} }, error: null });
  });

  it("retries once on 504 and succeeds with the same user code (AUTH-MFA-RESILIENT-504-001)", async () => {
    mockChallengeAndVerify
      .mockResolvedValueOnce({
        data: null,
        error: Object.assign(new Error("context deadline exceeded"), {
          status: 504,
          code: "request_timeout",
        }),
      })
      .mockResolvedValueOnce({
        data: { access_token: "at", refresh_token: "rt" },
        error: null,
      });

    await expect(MfaService.challengeAndVerifyResilient("factor-1", "123456")).resolves.toBeUndefined();
    expect(mockChallengeAndVerify).toHaveBeenCalledTimes(2);
    // Both calls used the SAME user code — no silent regeneration.
    expect(mockChallengeAndVerify.mock.calls[0][0]).toMatchObject({ factorId: "factor-1", code: "123456" });
    expect(mockChallengeAndVerify.mock.calls[1][0]).toMatchObject({ factorId: "factor-1", code: "123456" });
  });

  it("does NOT retry on 422 — verify fires exactly once and throws MfaInvalidCodeError (AUTH-MFA-422-NO-RETRY-001)", async () => {
    mockChallengeAndVerify.mockResolvedValue({
      data: null,
      error: Object.assign(new Error("Invalid TOTP code entered"), {
        status: 422,
        code: "invalid_code",
      }),
    });

    await expect(MfaService.challengeAndVerifyResilient("factor-1", "000000"))
      .rejects.toBeInstanceOf(MfaInvalidCodeError);
    expect(mockChallengeAndVerify).toHaveBeenCalledTimes(1);
  });

  it("throws MfaTransientError (not MfaInvalidCodeError) when the GoTrue endpoint persistently 504s", async () => {
    mockChallengeAndVerify.mockResolvedValue({
      data: null,
      error: Object.assign(new Error("context deadline exceeded"), {
        status: 504,
        code: "request_timeout",
      }),
    });

    await expect(MfaService.challengeAndVerifyResilient("factor-1", "654321"))
      .rejects.toBeInstanceOf(MfaTransientError);
    // 1 initial + 2 retries (capped by the service's retries:2)
    expect(mockChallengeAndVerify).toHaveBeenCalledTimes(3);
  });

  it("rejects malformed codes synchronously without calling GoTrue", async () => {
    await expect(MfaService.challengeAndVerifyResilient("factor-1", "12"))
      .rejects.toBeInstanceOf(MfaInvalidCodeError);
    expect(mockChallengeAndVerify).not.toHaveBeenCalled();
  });
});
