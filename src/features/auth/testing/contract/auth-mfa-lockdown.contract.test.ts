import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * AUTH-LOCKDOWN-08 — MFA (auth-mfa.service).
 *
 * Characterizes the AAL1→AAL2 transition and the post-verify quiet window.
 * The "verified TOTP but session below AAL2 → re-prompt" loop was one of the
 * documented June incident symptoms; these tests lock the contract so a
 * regression in the verify result mapping or the quiet window fails CI.
 *
 * Frozen layer — characterization only, no behavior change.
 */

vi.mock("../../services/auth-telemetry", () => ({
  emitAuthBeacon: vi.fn().mockResolvedValue(undefined),
  newCorrelationId: () => "test-correlation-id",
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      mfa: {
        verify: vi.fn(),
        getAuthenticatorAssuranceLevel: vi.fn(),
      },
    },
  },
}));

vi.mock("@/services/logger.service", () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { supabase } from "@/integrations/supabase/client";
import {
  verifyTotp,
  getAal,
  markRecentlyVerified,
  isWithinQuietWindow,
} from "../../services/auth-mfa.service";

const mfa = supabase.auth.mfa as unknown as {
  verify: ReturnType<typeof vi.fn>;
  getAuthenticatorAssuranceLevel: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AUTH-LOCKDOWN-08 — MFA verifyTotp", () => {
  const input = { factorId: "f1", challengeId: "c1", code: "123456" };

  it("returns signed_in on a valid TOTP code", async () => {
    mfa.verify.mockResolvedValue({ data: {}, error: null });

    const result = await verifyTotp(input);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.kind).toBe("signed_in");
  });

  it("maps a rejected code to mfa_invalid_code (the only MFA-counter code)", async () => {
    mfa.verify.mockResolvedValue({ data: null, error: { message: "Invalid TOTP code" } });

    const result = await verifyTotp(input);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("mfa_invalid_code");
  });

  it("never lets a thrown provider error cross the boundary (maps to unexpected)", async () => {
    mfa.verify.mockRejectedValue(new Error("network blip"));

    const result = await verifyTotp(input);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("unexpected");
  });

  it("marks the quiet window only after a successful verify", async () => {
    mfa.verify.mockResolvedValue({ data: {}, error: null });
    await verifyTotp(input);
    // Immediately after a success, a focus handler must not re-challenge.
    expect(isWithinQuietWindow()).toBe(true);
  });
});

describe("AUTH-LOCKDOWN-08 — AAL state", () => {
  it.each([
    ["aal2", "aal2"],
    ["aal1", "aal1"],
  ])("reports %s currentLevel as %s", async (level, expected) => {
    mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({ data: { currentLevel: level }, error: null });
    await expect(getAal()).resolves.toBe(expected);
  });

  it("reports unknown (never throws) when the provider errors", async () => {
    mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(getAal()).resolves.toBe("unknown");
  });

  it("reports unknown when the provider call throws", async () => {
    mfa.getAuthenticatorAssuranceLevel.mockRejectedValue(new Error("offline"));
    await expect(getAal()).resolves.toBe("unknown");
  });
});

describe("AUTH-LOCKDOWN-08 — quiet window timing", () => {
  it("holds for 10s after verification, then expires", () => {
    markRecentlyVerified(1_000);
    expect(isWithinQuietWindow(5_000)).toBe(true); // 4s elapsed
    expect(isWithinQuietWindow(10_999)).toBe(true); // 9.999s elapsed
    expect(isWithinQuietWindow(11_001)).toBe(false); // >10s elapsed
  });
});
