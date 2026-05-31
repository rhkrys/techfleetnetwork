import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithRouter } from "./test-utils";
import ResetPasswordPage from "@/pages/ResetPasswordPage";

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
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
    },
  },
}));

describe("ResetPasswordPage UI (BDD 20.1)", () => {
  it("20.1: shows invalid/expired link message when no recovery session", async () => {
    renderWithRouter(<ResetPasswordPage />);
    // Component starts in `checking` state, then asynchronously resolves to
    // the invalid-link branch once `supabase.auth.getSession()` settles with
    // no session. Use `findByText` to await that microtask.
    expect(await screen.findByText(/invalid or expired link/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /request a new link/i })).toBeInTheDocument();
  });
});
