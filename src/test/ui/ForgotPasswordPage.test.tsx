import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithRouter } from "./test-utils";
import ForgotPasswordPage from "@/pages/ForgotPasswordPage";
import { AuthService, GOOGLE_ONLY_ACCOUNT_CODE } from "@/services/auth.service";
import { RateLimitService } from "@/services/rate-limit.service";

vi.mock("@/services/auth.service", () => ({
  GOOGLE_ONLY_ACCOUNT_CODE: "GOOGLE_ONLY_ACCOUNT",
  GOOGLE_ONLY_ACCOUNT_MESSAGE: "This account uses Google sign-in. Use Google to continue; password reset is not available for this account.",
  AuthService: { resetPassword: vi.fn() },
}));
vi.mock("@/services/rate-limit.service", () => ({
  RateLimitService: {
    check: vi.fn().mockResolvedValue({ allowed: true, remaining: 5, retry_after: 0 }),
    peek: vi.fn().mockResolvedValue({ allowed: true, remaining: 5, retry_after: 0 }),
    recordFailure: vi.fn().mockResolvedValue({ allowed: true, remaining: 4, retry_after: 0 }),
  },
}));
vi.mock("@/lib/email-domain-validation", () => ({
  validateEmailDomainExists: vi.fn().mockResolvedValue({ valid: true }),
}));
vi.mock("@/components/auth/TurnstileChallenge", () => ({
  TurnstileChallenge: ({ onTokenChange }: { onTokenChange: (token: string) => void }) => (
    <button type="button" onClick={() => onTokenChange("valid-turnstile-token-with-enough-length")}>Pass CAPTCHA</button>
  ),
}));

describe("ForgotPasswordPage UI (BDD 19.1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(RateLimitService.peek).mockResolvedValue({ allowed: true, remaining: 5, retry_after: 0 });
    renderWithRouter(<ForgotPasswordPage />);
  });

  it("19.1: renders email input", () => {
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
  });

  it("19.1: renders Send Reset Link button", () => {
    expect(screen.getByRole("button", { name: /send reset link/i })).toBeInTheDocument();
  });

  it("19.1: renders sign-in link", () => {
    expect(screen.getByRole("link", { name: /sign in/i })).toBeInTheDocument();
  });

  it("19.1: renders heading", () => {
    expect(screen.getByText(/reset your password/i)).toBeInTheDocument();
  });

  it("AUTH-RESET-GOOGLE-ONLY-002: does not record reset failure for Google-only accounts", async () => {
    const err = new Error("This account uses Google sign-in.") as Error & { code?: string };
    err.code = GOOGLE_ONLY_ACCOUNT_CODE;
    vi.mocked(AuthService.resetPassword).mockRejectedValueOnce(err);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/email/i), "google@example.com");
    await user.click(screen.getByRole("button", { name: /pass captcha/i }));
    await user.click(screen.getByRole("button", { name: /send reset link/i }));

    expect(await screen.findByText(/uses Google sign-in/i)).toBeInTheDocument();
    expect(RateLimitService.recordFailure).not.toHaveBeenCalled();
  });

  it("AUTH-RESET-TRANSIENT-001: does not record reset failure for transient reset errors", async () => {
    vi.mocked(AuthService.resetPassword).mockRejectedValueOnce(Object.assign(new Error("Failed to fetch"), { status: 0 }));
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/email/i), "member@example.com");
    await user.click(screen.getByRole("button", { name: /pass captcha/i }));
    await user.click(screen.getByRole("button", { name: /send reset link/i }));

    expect(await screen.findByText(/check your email/i)).toBeInTheDocument();
    expect(RateLimitService.recordFailure).not.toHaveBeenCalled();
  });
});
