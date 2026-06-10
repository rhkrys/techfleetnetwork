import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithRouter } from "./test-utils";
import ResetPasswordPage from "@/pages/ResetPasswordPage";
import ConfirmRecoveryLinkPage from "@/pages/ConfirmRecoveryLinkPage";
import { AuthService } from "@/services/auth.service";
import { supabase } from "@/integrations/supabase/client";

vi.mock("@/services/auth.service", () => ({
  AuthService: {
    updatePassword: vi.fn(),
    signOutAllDevices: vi.fn(() => Promise.resolve({ revocationRecorded: true })),
  },
}));

vi.mock("@/lib/auth/reset-telemetry", () => ({
  recordResetTelemetry: vi.fn(),
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

const sessionUser = { data: { user: { id: "user-1", email: "u@example.com" } }, error: null };

describe("ResetPasswordPage UI (BDD 20.1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(supabase.auth.getSession).mockResolvedValue({ data: { session: null }, error: null } as never);
    vi.mocked(supabase.auth.getUser).mockResolvedValue({ data: { user: null }, error: null } as never);
    vi.mocked(supabase.auth.verifyOtp).mockResolvedValue({ data: { session: null }, error: null } as never);
    vi.mocked(supabase.auth.setSession).mockResolvedValue({ data: { session: null }, error: null } as never);
    window.history.replaceState({}, "", "/reset-password");
  });

  it("20.1: shows invalid/expired link message when no recovery session", async () => {
    renderWithRouter(<ResetPasswordPage />);
    expect(await screen.findByText(/invalid or expired link/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /request a new link/i })).toBeInTheDocument();
  });

  it("AUTH-RESET-SESSION-001: ordinary signed-in sessions do not unlock password reset", async () => {
    vi.mocked(supabase.auth.getSession).mockResolvedValue({ data: { session: { user: { id: "user-1" } } }, error: null } as never);

    renderWithRouter(<ResetPasswordPage />);

    expect(await screen.findByText(/invalid or expired link/i)).toBeInTheDocument();
    expect(AuthService.updatePassword).not.toHaveBeenCalled();
  });

  it("AUTH-RESET-SESSION-003: verifyOtp success without an active session keeps form locked", async () => {
    // verifyOtp returns no error but getUser shows nobody — must block form.
    vi.mocked(supabase.auth.verifyOtp).mockResolvedValue({ data: { session: null }, error: null } as never);
    vi.mocked(supabase.auth.getUser).mockResolvedValue({ data: { user: null }, error: null } as never);
    window.history.replaceState({}, "", "/reset-password?token_hash=abc123&type=recovery&reset_intent=confirm");

    renderWithRouter(<ResetPasswordPage />);

    expect(await screen.findByText(/invalid or expired link/i)).toBeInTheDocument();
    expect(AuthService.updatePassword).not.toHaveBeenCalled();
  });

  it("AUTH-RESET-010: blocks mismatched password confirmation before service call", async () => {
    vi.mocked(supabase.auth.verifyOtp).mockResolvedValue({ data: { session: { user: { id: "user-1" } } }, error: null } as never);
    vi.mocked(supabase.auth.getUser).mockResolvedValue(sessionUser as never);
    window.history.replaceState({}, "", "/reset-password?token_hash=abc123&type=recovery&reset_intent=confirm");
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
    vi.mocked(supabase.auth.verifyOtp).mockResolvedValue({ data: { session: { user: { id: "user-1" } } }, error: null } as never);
    vi.mocked(supabase.auth.getUser).mockResolvedValue(sessionUser as never);
    vi.mocked(AuthService.updatePassword).mockResolvedValue({ otherDevicesRevoked: true });
    window.history.replaceState({}, "", "/reset-password?token_hash=abc123&type=recovery&reset_intent=confirm");
    const user = userEvent.setup();

    renderWithRouter(<ResetPasswordPage />);

    await screen.findByRole("heading", { name: /set your new password/i });
    await user.type(screen.getByLabelText(/^new password$/i), "StrongPass123!");
    await user.type(screen.getByLabelText(/confirm new password/i), "StrongPass123!");
    await user.click(screen.getByRole("button", { name: /update password/i }));

    expect(AuthService.updatePassword).toHaveBeenCalledWith({ password: "StrongPass123!", confirmPassword: "StrongPass123!" });
    expect(await screen.findByText(/use your new password the next time you sign in/i)).toBeInTheDocument();
  });

  it("AUTH-RESET-PREFETCH-001: direct token_hash landing waits for user gesture before verifyOtp", async () => {
    window.history.replaceState({}, "", "/reset-password?token_hash=abc123&type=recovery");

    renderWithRouter(<ResetPasswordPage />);

    expect(await screen.findByRole("heading", { name: /continue resetting your password/i })).toBeInTheDocument();
    expect(supabase.auth.verifyOtp).not.toHaveBeenCalled();
  });

  it("AUTH-RESET-PREFETCH-004: confirm page never verifies on load", async () => {
    window.history.replaceState({}, "", "/reset-password/confirm?token_hash=abc123&type=recovery");

    renderWithRouter(<ConfirmRecoveryLinkPage />);

    expect(await screen.findByRole("button", { name: /continue resetting password/i })).toBeInTheDocument();
    expect(supabase.auth.verifyOtp).not.toHaveBeenCalled();
  });

  it("AUTH-RESET-020: confirmed token_hash query settles to valid recovery via verifyOtp", async () => {
    vi.mocked(supabase.auth.verifyOtp).mockResolvedValue({ data: { session: { user: { id: "u" } } }, error: null } as never);
    vi.mocked(supabase.auth.getUser).mockResolvedValue(sessionUser as never);
    const replaceState = vi.spyOn(window.history, "replaceState");
    window.history.replaceState({}, "", "/reset-password?token_hash=abc123&type=recovery&reset_intent=confirm");

    renderWithRouter(<ResetPasswordPage />);

    await screen.findByRole("heading", { name: /set your new password/i });
    expect(supabase.auth.verifyOtp).toHaveBeenCalledWith({ type: "recovery", token_hash: "abc123" });
    expect(replaceState).toHaveBeenCalled();
    expect(window.location.search).not.toContain("token_hash");
    replaceState.mockRestore();
    window.history.replaceState({}, "", "/reset-password");
  });

  it("AUTH-RESET-022: invalid token_hash falls back to invalid-link message", async () => {
    vi.mocked(supabase.auth.verifyOtp).mockResolvedValue({ data: { session: null }, error: { message: "expired" } } as never);
    vi.mocked(supabase.auth.getSession).mockResolvedValue({ data: { session: null }, error: null } as never);
    window.history.replaceState({}, "", "/reset-password?token_hash=expired&type=recovery&reset_intent=confirm");

    renderWithRouter(<ResetPasswordPage />);

    expect(await screen.findByText(/invalid or expired link/i)).toBeInTheDocument();
    window.history.replaceState({}, "", "/reset-password");
  });

  it("AUTH-RESET-023: legacy hash recovery sets the session manually", async () => {
    vi.mocked(supabase.auth.setSession).mockResolvedValue({ data: { session: { user: { id: "u" } } }, error: null } as never);
    vi.mocked(supabase.auth.getUser).mockResolvedValue(sessionUser as never);
    const replaceState = vi.spyOn(window.history, "replaceState");
    window.history.replaceState({}, "", "/reset-password#access_token=access.jwt&refresh_token=refresh.jwt&type=recovery");

    renderWithRouter(<ResetPasswordPage />);

    await screen.findByRole("heading", { name: /set your new password/i });
    expect(supabase.auth.setSession).toHaveBeenCalledWith({ access_token: "access.jwt", refresh_token: "refresh.jwt" });
    expect(replaceState).toHaveBeenCalled();
    expect(window.location.hash).not.toContain("access_token");
    replaceState.mockRestore();
    window.history.replaceState({}, "", "/reset-password");
  });

  it("AUTH-RESET-SESSION-002: exchangeCodeForSession success without active session keeps form locked", async () => {
    vi.mocked(supabase.auth.exchangeCodeForSession).mockResolvedValue({ data: { session: null }, error: null } as never);
    vi.mocked(supabase.auth.getUser).mockResolvedValue({ data: { user: null }, error: null } as never);
    window.history.replaceState({}, "", "/reset-password?code=pkce-abc&type=recovery");

    renderWithRouter(<ResetPasswordPage />);

    expect(await screen.findByText(/invalid or expired link/i)).toBeInTheDocument();
    expect(AuthService.updatePassword).not.toHaveBeenCalled();
    window.history.replaceState({}, "", "/reset-password");
  });

  it("AUTH-RESET-SESSION-004: setSession success but getUser failure keeps form locked", async () => {
    vi.mocked(supabase.auth.setSession).mockResolvedValue({ data: { session: { user: { id: "u" } } }, error: null } as never);
    vi.mocked(supabase.auth.getUser).mockResolvedValue({ data: { user: null }, error: { message: "Auth session missing" } } as never);
    window.history.replaceState({}, "", "/reset-password#access_token=a.jwt&refresh_token=r.jwt&type=recovery");

    renderWithRouter(<ResetPasswordPage />);

    expect(await screen.findByText(/invalid or expired link/i)).toBeInTheDocument();
    expect(AuthService.updatePassword).not.toHaveBeenCalled();
    window.history.replaceState({}, "", "/reset-password");
  });
});
