/**
 * AUTH-MFA-NO-PRECREATE-001 + AUTH-MFA-TRANSIENT-PRESERVES-INPUT-001:
 *
 *  - `MfaChallengeDialog` MUST NOT call `MfaService.createChallenge` on open.
 *  - Verify click invokes `challengeAndVerifyResilient` exactly once per click.
 *  - On a transient error the input retains the typed digits; only a real
 *    `MfaInvalidCodeError` clears the input.
 *
 * We stub `input-otp` with a plain `<input>` so `setCode` flows reliably in
 * jsdom (the real `input-otp` package depends on `document.elementFromPoint`
 * which jsdom does not implement).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

// jsdom doesn't implement elementFromPoint (used by input-otp's PWM badge
// timer). Stub it so the real OTPInput renders without throwing.
if (typeof document !== "undefined" && typeof document.elementFromPoint !== "function") {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (document as any).elementFromPoint = () => null;
}

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

// Replace input-otp with a single plain <input data-testid="otp"> that fires
// the dialog's onChange in jsdom-friendly fashion.
vi.mock("@/components/ui/input-otp", () => {
  return {
    InputOTP: ({ value, onChange, onComplete, maxLength, id }: {
      value: string;
      onChange: (v: string) => void;
      onComplete?: (v: string) => void;
      maxLength: number;
      id?: string;
    }) => (
      <input
        data-testid="otp"
        id={id}
        value={value}
        maxLength={maxLength}
        onChange={(e) => {
          onChange(e.target.value);
          if (e.target.value.length === maxLength) onComplete?.(e.target.value);
        }}
      />
    ),
    InputOTPGroup: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    InputOTPSlot: () => null,
  };
});

function setup() {
  const onSuccess = vi.fn();
  const onCancel = vi.fn();
  render(<MfaChallengeDialog open onSuccess={onSuccess} onCancel={onCancel} />);
  return { onSuccess, onCancel };
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
    await act(async () => { await Promise.resolve(); });
    expect(createChallenge).not.toHaveBeenCalled();
  });

  it("calls challengeAndVerifyResilient exactly once per Verify click", async () => {
    challengeAndVerifyResilient.mockResolvedValue(undefined);
    const { onSuccess } = setup();
    await waitFor(() => expect(listFactors).toHaveBeenCalled());

    // Wait for factor to populate so the InputOTP renders.
    const otp = await screen.findByTestId("otp");
    // Disable onComplete auto-fire by setting up to 5 first then 6 in one go
    fireEvent.change(otp, { target: { value: "123456" } });
    // onComplete fires handleVerify already — wait for that single call.
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

    const otp = await screen.findByTestId("otp");
    fireEvent.change(otp, { target: { value: "123456" } });

    await waitFor(() => expect(challengeAndVerifyResilient).toHaveBeenCalled());
    await waitFor(() => {
      expect((screen.getByTestId("otp") as HTMLInputElement).value).toBe("123456");
    });
  });

  it("on MfaInvalidCodeError, clears the input", async () => {
    challengeAndVerifyResilient.mockRejectedValue(
      new MfaInvalidCodeError("That 6-digit code didn't match. Open your authenticator and enter the newest code."),
    );
    setup();
    await waitFor(() => expect(listFactors).toHaveBeenCalled());

    const otp = await screen.findByTestId("otp");
    fireEvent.change(otp, { target: { value: "000000" } });

    await waitFor(() => expect(challengeAndVerifyResilient).toHaveBeenCalled());
    await waitFor(() => {
      expect((screen.getByTestId("otp") as HTMLInputElement).value).toBe("");
    });
  });
});
