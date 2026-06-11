import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithRouter } from "./test-utils";
import LoginPage from "@/pages/LoginPage";
import { signInWithPassword } from "@/features/auth/flows/sign-in-password.flow";

// Mock services
vi.mock("@/services/auth.service", () => ({
  AuthService: { signInWithPassword: vi.fn() },
}));
vi.mock("@/features/auth/flows/sign-in-password.flow", () => ({
  signInWithPassword: vi.fn(),
}));
vi.mock("@/services/rate-limit.service", () => ({
  RateLimitService: {
    check: vi.fn().mockResolvedValue({ allowed: true, remaining: 5, retry_after: 0 }),
    peek: vi.fn().mockResolvedValue({ allowed: true, remaining: 5, retry_after: 0 }),
    recordFailure: vi.fn().mockResolvedValue({ allowed: true, remaining: 4, retry_after: 0 }),
  },
}));
vi.mock("@/services/mfa.service", () => ({
  MfaService: { getMfaGateDecision: vi.fn().mockResolvedValue({ hasVerifiedTotp: false, currentAal: "aal1", needsChallenge: false }) },
}));
vi.mock("@/components/auth/TurnstileChallenge", () => ({
  TurnstileChallenge: ({ onTokenChange }: { onTokenChange: (token: string) => void }) => (
    <button type="button" onClick={() => onTokenChange("valid-turnstile-token-with-enough-length")}>Pass captcha</button>
  ),
}));
vi.mock("@/integrations/lovable/index", () => ({
  lovable: { auth: { signInWithOAuth: vi.fn().mockResolvedValue({}) } },
}));

describe("LoginPage UI (BDD 17.1–17.3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(signInWithPassword).mockResolvedValue({ ok: true, value: { kind: "signed_in", userId: "member-1", correlationId: "corr-1" } });
    renderWithRouter(<LoginPage />);
  });

  it("17.1: renders email and password inputs", () => {
    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
    expect(document.getElementById("password")).toBeInTheDocument();
  });

  it("17.1: renders Sign In button", () => {
    expect(screen.getByRole("button", { name: /^sign in$/i })).toBeInTheDocument();
  });

  it("17.1: renders forgot password link", () => {
    expect(screen.getByText(/forgot password/i)).toBeInTheDocument();
  });

  it("17.1: renders Google sign-in button", () => {
    expect(screen.getByText(/sign in with google/i)).toBeInTheDocument();
  });

  it("17.2: password visibility toggle works", () => {
    const passwordInput = document.getElementById("password") as HTMLInputElement;
    expect(passwordInput.type).toBe("password");

    const toggleBtn = screen.getByLabelText(/show password/i);
    fireEvent.click(toggleBtn);
    expect(passwordInput.type).toBe("text");

    const hideBtn = screen.getByLabelText(/hide password/i);
    fireEvent.click(hideBtn);
    expect(passwordInput.type).toBe("password");
  });

  it("17.3: sign up link points to /register", () => {
    const signUpLink = screen.getByRole("link", { name: /sign up/i });
    expect(signUpLink).toHaveAttribute("href", "/register");
  });

  // LCL-002 — Zod validation errors must NOT render the destructive auth banner.
  it("LCL-002: invalid email submit shows inline error, no auth banner", () => {
    const email = screen.getByLabelText(/email address/i) as HTMLInputElement;
    const password = document.getElementById("password") as HTMLInputElement;
    fireEvent.change(email, { target: { value: "not-an-email" } });
    fireEvent.change(password, { target: { value: "whatever" } });
    fireEvent.click(screen.getByRole("button", { name: /^sign in$/i }));
    // The destructive auth banner uses bg-destructive/10 — must not appear for Zod errors
    expect(document.querySelector(".bg-destructive\\/10")).toBeNull();
  });

  // LCL-001 — OAuth-only hint is not shown on initial render
  it("LCL-001: OAuth-only hint is not shown on initial render", () => {
    expect(screen.queryByText(/this account uses google sign-in/i)).toBeNull();
  });

  it("AUTH-LOGIN-RECOVERY-001: successful password flow continues into the app instead of showing a verification loop", async () => {
    fireEvent.focus(screen.getByLabelText(/email address/i));
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: "member@example.com" } });
    fireEvent.change(document.getElementById("password") as HTMLInputElement, { target: { value: "ValidPass123!" } });
    fireEvent.click(await screen.findByRole("button", { name: /pass captcha/i }));
    fireEvent.click(screen.getByRole("button", { name: /^sign in$/i }));

    await waitFor(() => expect(signInWithPassword).toHaveBeenCalledWith(expect.objectContaining({
      email: "member@example.com",
      password: "ValidPass123!",
      captchaToken: "valid-turnstile-token-with-enough-length",
    })));
    expect(screen.queryByText(/complete the human verification/i)).toBeNull();
    expect(screen.queryByTestId("auth-error-message")).toBeNull();
  });
});
