import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MfaEnforcementGuard } from "@/components/MfaEnforcementGuard";

const mockUseAuth = vi.fn();
const mockGetMfaGateDecision = vi.fn();
const mockSignOut = vi.fn();
// Must be hoisted above imports: cached-session.ts calls
// supabase.auth.onAuthStateChange at module load (during the import chain),
// which runs before plain `const` initializers — otherwise "Cannot access
// 'mockOnAuthStateChange' before initialization".
const { mockOnAuthStateChange, mockNavigate } = vi.hoisted(() => ({
  mockOnAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: () => {} } } })),
  mockNavigate: vi.fn(),
}));

// The guard now redirects via SPA navigate("/login", { replace: true }) on MFA
// refusal (NO-RELOAD-TAB-002), not window.location.replace. Mock useNavigate
// while keeping the real MemoryRouter.
vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => mockNavigate,
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock("@/services/mfa.service", () => ({
  MfaService: { getMfaGateDecision: () => mockGetMfaGateDecision() },
}));

vi.mock("@/components/MfaChallengeDialog", () => ({
  MfaChallengeDialog: ({ open, onCancel }: { open: boolean; onCancel: () => void }) =>
    open ? (
      <div role="dialog" aria-label="Two-Factor Verification">
        <button type="button" onClick={onCancel}>
          Cancel 2FA
        </button>
      </div>
    ) : null,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      signOut: () => mockSignOut(),
      onAuthStateChange: (...args: unknown[]) => mockOnAuthStateChange(...args),
    },
  },
}));

describe("MfaEnforcementGuard (BDD AUTH-2FA-LOGIN-GATE-002/003, AUTH-2FA-MEMBER-001/002)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue({
      user: { id: "user-1" },
      session: { access_token: "token-1" },
      loading: false,
    });
    mockGetMfaGateDecision.mockResolvedValue({
      hasVerifiedTotp: true,
      currentAal: "aal1",
      needsChallenge: true,
    });
    mockSignOut.mockResolvedValue(undefined);
    Object.defineProperty(window, "location", {
      value: { replace: vi.fn() },
      writable: true,
    });
  });

  it("prompts any enrolled user for authenticator 2FA when AAL is below aal2", async () => {
    render(
      <MemoryRouter>
        <MfaEnforcementGuard />
      </MemoryRouter>
    );
    expect(
      await screen.findByRole("dialog", { name: /two-factor verification/i })
    ).toBeInTheDocument();
    expect(mockGetMfaGateDecision).toHaveBeenCalledTimes(1);
  });

  it("does NOT prompt members who have no verified TOTP factor", async () => {
    mockGetMfaGateDecision.mockResolvedValueOnce({
      hasVerifiedTotp: false,
      currentAal: "aal1",
      needsChallenge: false,
    });
    render(
      <MemoryRouter>
        <MfaEnforcementGuard />
      </MemoryRouter>
    );
    await waitFor(() => expect(mockGetMfaGateDecision).toHaveBeenCalledTimes(1));
    expect(
      screen.queryByRole("dialog", { name: /two-factor verification/i })
    ).not.toBeInTheDocument();
  });

  it("signs out an AAL1 session when the user cancels the required 2FA challenge", async () => {
    render(
      <MemoryRouter>
        <MfaEnforcementGuard />
      </MemoryRouter>
    );
    const cancelButton = await screen.findByRole("button", { name: /cancel 2fa/i });
    fireEvent.click(cancelButton);
    await waitFor(() => expect(mockSignOut).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/login", { replace: true }));
  });
});
