import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AdminTwoFactorGraceDialog } from "@/components/AdminTwoFactorGraceDialog";

const mockUseAuth = vi.fn();
const mockUseAdmin = vi.fn();
const mockHasVerifiedTotp = vi.fn();
const mockRpc = vi.fn();
const mockSignOut = vi.fn();

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => mockUseAuth() }));
vi.mock("@/hooks/use-admin", () => ({ useAdmin: () => mockUseAdmin() }));
vi.mock("@/services/mfa.service", () => ({
  MfaService: { hasVerifiedTotp: () => mockHasVerifiedTotp() },
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      signOut: () => mockSignOut(),
      // cached-session.ts subscribes at module load during import.
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

function renderWithRouter() {
  return render(
    <MemoryRouter initialEntries={["/dashboard"]}>
      <AdminTwoFactorGraceDialog />
    </MemoryRouter>
  );
}

describe("AdminTwoFactorGraceDialog (BDD AUTH-2FA-PROMOTION-002/003/004)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue({ user: { id: "u1" }, profileLoaded: true, loading: false });
    mockUseAdmin.mockReturnValue({ isAdmin: true, loading: false });
    mockSignOut.mockResolvedValue(undefined);
    Object.defineProperty(window, "location", {
      value: { replace: vi.fn() },
      writable: true,
      configurable: true,
    });
    mockRpc.mockImplementation((fn: string) => {
      if (fn === "admin_2fa_grace_active") return Promise.resolve({ data: true, error: null });
      if (fn === "admin_2fa_grace_deadline") {
        const deadline = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
        return Promise.resolve({ data: deadline, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });
  });

  it("shows persistent setup modal when admin lacks TOTP and grace is active", async () => {
    mockHasVerifiedTotp.mockResolvedValue(false);
    renderWithRouter();
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/Set up admin 2FA/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /set up 2fa now/i })).toHaveAttribute(
      "href",
      "/profile/edit?tab=account"
    );
  });

  it("does NOT render when grace is inactive", async () => {
    mockHasVerifiedTotp.mockResolvedValue(false);
    mockRpc.mockImplementation((fn: string) =>
      fn === "admin_2fa_grace_active"
        ? Promise.resolve({ data: false, error: null })
        : Promise.resolve({ data: null, error: null })
    );
    renderWithRouter();
    await waitFor(() => expect(mockRpc).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("does NOT render for non-admins", async () => {
    mockUseAdmin.mockReturnValue({ isAdmin: false, loading: false });
    mockHasVerifiedTotp.mockResolvedValue(false);
    renderWithRouter();
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("hides immediately once a verified TOTP factor exists", async () => {
    mockHasVerifiedTotp.mockResolvedValue(true);
    renderWithRouter();
    await waitFor(() => expect(mockHasVerifiedTotp).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Sign out button calls supabase.auth.signOut and redirects to /login", async () => {
    mockHasVerifiedTotp.mockResolvedValue(false);
    renderWithRouter();
    const btn = await screen.findByRole("button", { name: /sign out/i });
    fireEvent.click(btn);
    await waitFor(() => expect(mockSignOut).toHaveBeenCalledTimes(1));
    expect(
      (window.location as unknown as { replace: ReturnType<typeof vi.fn> }).replace
    ).toHaveBeenCalledWith("/login");
  });
});
