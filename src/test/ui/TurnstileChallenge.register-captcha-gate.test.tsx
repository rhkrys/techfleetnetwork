import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { TurnstileChallenge } from "@/components/auth/TurnstileChallenge";
import { hasFreshLoginCaptchaVerification } from "@/lib/auth-captcha";

// Telemetry does network side effects on the login surface; stub it out.
vi.mock("@/lib/login-telemetry", () => ({
  recordLoginEvent: vi.fn(),
  newAttemptId: () => "attempt-test",
}));

// Capture the options object Turnstile is rendered with so we can invoke the
// success callback the way the real widget does after "Success!".
let capturedOptions: Record<string, any> | null = null;

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  capturedOptions = null;
  (window as any).turnstile = {
    render: (_el: HTMLElement, options: Record<string, any>) => {
      capturedOptions = options;
      return "widget-under-test";
    },
    reset: vi.fn(),
    remove: vi.fn(),
  };
});

afterEach(() => {
  cleanup();
  delete (window as any).turnstile;
});

async function solve(action: "login" | "register" | "forgot_password" | "signup_confirmation_resend", token: string) {
  const onToken = vi.fn();
  render(<TurnstileChallenge action={action} onTokenChange={onToken} />);
  await waitFor(() => expect(capturedOptions).not.toBeNull());
  capturedOptions!.callback(token);
  return onToken;
}

describe("TurnstileChallenge unlocks the client captcha gate for every auth action (BDD AUTH-CAPTCHA-REGISTER-GATE-20260707)", () => {
  // Regression: the client throttle (client-request-throttle) blocks ALL auth
  // POSTs — signup/recover/resend, not just login — until
  // hasFreshLoginCaptchaVerification() is true. The widget previously called
  // markLoginCaptchaVerified() only when action==="login", so a completed
  // register challenge left the gate closed and every signup died locally with
  // a 403 "Complete the human verification before trying again."
  it("register: a completed challenge satisfies the client captcha gate", async () => {
    expect(hasFreshLoginCaptchaVerification()).toBe(false);
    const onToken = await solve("register", "tok-register");
    expect(onToken).toHaveBeenCalledWith("tok-register");
    expect(hasFreshLoginCaptchaVerification()).toBe(true);
  });

  it("forgot_password: a completed challenge satisfies the client captcha gate", async () => {
    await solve("forgot_password", "tok-fp");
    expect(hasFreshLoginCaptchaVerification()).toBe(true);
  });

  it("login: a completed challenge still satisfies the client captcha gate", async () => {
    await solve("login", "tok-login");
    expect(hasFreshLoginCaptchaVerification()).toBe(true);
  });
});
