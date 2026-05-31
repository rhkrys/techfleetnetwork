import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithRouter } from "./test-utils";
import ResetPasswordPage from "@/pages/ResetPasswordPage";

vi.mock("@/services/auth.service", () => ({
  AuthService: { updatePassword: vi.fn() },
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: vi.fn(() => Promise.resolve({ data: { session: null }, error: null })),
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
    },
  },
}));


describe("ResetPasswordPage UI (BDD 20.1)", () => {
  it("20.1: shows invalid/expired link message when no recovery session", () => {
    renderWithRouter(<ResetPasswordPage />);
    expect(screen.getByText(/invalid or expired link/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /request a new link/i })).toBeInTheDocument();
  });
});
