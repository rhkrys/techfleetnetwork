import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithRouter } from "./test-utils";
import ResetPasswordPage from "@/pages/ResetPasswordPage";
import { AuthService } from "@/services/auth.service";
import { supabase } from "@/integrations/supabase/client";

vi.mock("@/services/auth.service", () => ({
  AuthService: {
    updatePassword: vi.fn(),
    signOutAllDevices: vi.fn(() => Promise.resolve({ revocationRecorded: true })),
  },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: vi.fn(() => Promise.resolve({ data: { session: null }, error: null })),
      getUser: vi.fn(() => Promise.resolve({ data: { user: null }, error: null })),
      exchangeCodeForSession: vi.fn(() => Promise.resolve({ data: { session: null }, error: null })),
      verifyOtp: vi.fn(() => Promise.resolve({ data: { session: null }, error: null })),
      setSession: vi.fn(() => Promise.resolve({ data: { session: null }, error: null })),
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
    },
    rpc: vi.fn(() => Promise.resolve({ data: null, error: null })),
  },
}));

describe("ResetPasswordPage UI (BDD 20.1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("20.1: shows invalid/expired link message when no recovery session", async () => {
    renderWithRouter(<ResetPasswordPage />);
    // Component starts in `checking` state, then asynchronously resolves to
    // the invalid-link branch once `supabase.auth.getSession()` settles with
    // no session. Use `findByText` to await that microtask.
    expect(await screen.findByText(/invalid or expired link/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /request a new link/i })).toBeInTheDocument();
  });

  it("AUTH-RESET-010: blocks mismatched password confirmation before service call", async () => {
    vi.mocked(supabase.auth.getSession).mockResolvedValue({ data: { session: { user: { id: "user-1" } } }, error: null } as never);
    const user = userEvent.setup();

    renderWithRouter(<ResetPasswordPage />);

    await screen.findByRole("heading", { name: /set your new password/i });
    await user.type(screen.getByLabelText(/^new password$/i), "StrongPass123!");
    await user.type(screen.getByLabelText(/confirm new password/i), "StrongPass124!");

    expect(screen.getByText(/passwords do not match/i)).toHaveAttribute("role", "alert");
    expect(screen.getByRole("button", { name: /update password/i })).toBeDisabled();
    expect(AuthService.updatePassword).not.toHaveBeenCalled();
  });

  it("AUTH-RESET-011: submits only matching confirmed passwords", async () => {
    vi.mocked(supabase.auth.getSession).mockResolvedValue({ data: { session: { user: { id: "user-1" } } }, error: null } as never);
    vi.mocked(AuthService.updatePassword).mockResolvedValue({ otherDevicesRevoked: true });
    const user = userEvent.setup();

    renderWithRouter(<ResetPasswordPage />);

    await screen.findByRole("heading", { name: /set your new password/i });
    await user.type(screen.getByLabelText(/^new password$/i), "StrongPass123!");
    await user.type(screen.getByLabelText(/confirm new password/i), "StrongPass123!");
    await user.click(screen.getByRole("button", { name: /update password/i }));

    expect(AuthService.updatePassword).toHaveBeenCalledWith({ password: "StrongPass123!", confirmPassword: "StrongPass123!" });
    expect(await screen.findByText(/use your new password the next time you sign in/i)).toBeInTheDocument();
  });
});
