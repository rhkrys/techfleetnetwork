/**
 * AUTH-MFA-NO-PRECREATE-001 + AUTH-MFA-TRANSIENT-PRESERVES-INPUT-001:
 *
 *  - `MfaChallengeDialog` MUST NOT call `MfaService.createChallenge` on
 *    open. The challenge is created microseconds before verify inside
 *    `challengeAndVerifyResilient` — pre-creating leads to TTL expiry by
 *    the time the user finishes typing 6 digits.
 *  - Verify click invokes `challengeAndVerifyResilient` exactly once per
 *    click (no double-fire from React strict mode or input completion).
 *  - On a transient error the input retains the typed digits — only a real
 *    `MfaInvalidCodeError` clears the input.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { MfaChallengeDialog } from "@/components/MfaChallengeDialog";
import { MfaInvalidCodeError, MfaTransientError } from "@/services/mfa.service";

const { listFactors, createChallenge, challengeAndVerifyResilient } = vi.hoisted(() => ({
  listFactors: vi.fn(),
  createChallenge: vi.fn(),
  challengeAndVerifyResilient: vi.fn(),
}));

vi.mock("@/services/mfa.service", async () => {
  const actual = await vi.importActual<typeof import("@/services/mfa.service")>("@/services/mfa.service");
  return {
    ...actual,
    MfaService: {
      listFactors,
      createChallenge,
      challengeAndVerifyResilient,
      challengeAndVerify: challengeAndVerifyResilient,
    },
  };
});

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function setup() {
  const onSuccess = vi.fn();
  const onCancel = vi.fn();
  render(<MfaChallengeDialog open onSuccess={onSuccess} onCancel={onCancel} />);
  return { onSuccess, onCancel };
}

function typeCode(value: string) {
  // input-otp wraps a hidden <input>; setting its value via change is
  // sufficient for the dialog's `onChange={setCode}` plumbing.
  const input = document.querySelector("input") as HTMLInputElement;
  fireEvent.input(input, { target: { value } });
}

describe("MfaChallengeDialog — no pre-create + transient input preservation", () => {
  beforeEach(() => {
    listFactors.mockReset();
    createChallenge.mockReset();
    challengeAndVerifyResilient.mockReset();
    listFactors.mockResolvedValue([{ id: "f1", factor_type: "totp", status: "verified" }]);
  });

  it("does NOT call createChallenge on open (AUTH-MFA-NO-PRECREATE-001)", async () => {
    setup();
    await waitFor(() => expect(listFactors).toHaveBeenCalled());
    // Settle any subsequent microtasks from the dialog's open effect.
    await act(async () => { await Promise.resolve(); });
    expect(createChallenge).not.toHaveBeenCalled();
  });

  it("calls challengeAndVerifyResilient exactly once per Verify click", async () => {
    challengeAndVerifyResilient.mockResolvedValue(undefined);
    const { onSuccess } = setup();
    await waitFor(() => expect(listFactors).toHaveBeenCalled());

    typeCode("123456");
    const verifyBtn = await screen.findByRole("button", { name: /verify/i });
    fireEvent.click(verifyBtn);

    await waitFor(() => expect(challengeAndVerifyResilient).toHaveBeenCalledTimes(1));
    expect(challengeAndVerifyResilient).toHaveBeenCalledWith("f1", "123456");
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(createChallenge).not.toHaveBeenCalled();
  });

  it("on MfaTransientError, retains the typed digits (AUTH-MFA-TRANSIENT-PRESERVES-INPUT-001)", async () => {
    challengeAndVerifyResilient.mockRejectedValue(
      new MfaTransientError("Two-factor service is briefly unavailable. Your code is still valid — tap Verify again."),
    );
    setup();
    await waitFor(() => expect(listFactors).toHaveBeenCalled());

    typeCode("123456");
    const verifyBtn = await screen.findByRole("button", { name: /verify/i });
    fireEvent.click(verifyBtn);

    await waitFor(() => expect(challengeAndVerifyResilient).toHaveBeenCalled());
    // After the rejection settles, the input STILL holds the same digits.
    await waitFor(() => {
      const input = document.querySelector("input") as HTMLInputElement;
      expect(input.value).toBe("123456");
    });
  });

  it("on MfaInvalidCodeError, clears the input", async () => {
    challengeAndVerifyResilient.mockRejectedValue(
      new MfaInvalidCodeError("That 6-digit code didn't match. Open your authenticator and enter the newest code."),
    );
    setup();
    await waitFor(() => expect(listFactors).toHaveBeenCalled());

    typeCode("000000");
    const verifyBtn = await screen.findByRole("button", { name: /verify/i });
    fireEvent.click(verifyBtn);

    await waitFor(() => expect(challengeAndVerifyResilient).toHaveBeenCalled());
    await waitFor(() => {
      const input = document.querySelector("input") as HTMLInputElement;
      expect(input.value).toBe("");
    });
  });
});
