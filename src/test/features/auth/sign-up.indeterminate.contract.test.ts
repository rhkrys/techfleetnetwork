/**
 * SIGNUP-TIMEOUT-PROBE-001..005 — when GoTrue 504s / times out / network-aborts
 * mid-/signup, the row may already exist server-side. The flow MUST probe via
 * signInWithPassword and surface the true state instead of bouncing the user
 * with a misleading "timed out" message.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/integrations/supabase/client", () => {
  const auth = {
    signUp: vi.fn(),
    signInWithPassword: vi.fn(),
  };
  return {
    supabase: {
      auth,
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    },
  };
});

import { supabase } from "@/integrations/supabase/client";
import { signUp } from "@/features/auth/flows/sign-up.flow";

const auth = supabase.auth as unknown as {
  signUp: ReturnType<typeof vi.fn>;
  signInWithPassword: ReturnType<typeof vi.fn>;
};

const baseInput = {
  email: "probe@example.com",
  password: "Password!1234",
  emailRedirectTo: "http://localhost/profile-setup",
};

beforeEach(() => {
  auth.signUp.mockReset();
  auth.signInWithPassword.mockReset();
});

describe("sign-up indeterminate-resolve probe", () => {
  it("SIGNUP-TIMEOUT-PROBE-001: 504 + probe signs in → signed_in", async () => {
    auth.signUp.mockResolvedValue({
      data: null,
      error: { message: "504 timeout", status: 504, code: "request_timeout" },
    });
    auth.signInWithPassword.mockResolvedValue({
      data: { user: { id: "u-1" }, session: { access_token: "t" } },
      error: null,
    });

    const result = await signUp(baseInput);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.kind).toBe("signed_in");
    expect(auth.signInWithPassword).toHaveBeenCalledTimes(1);
  });

  it("SIGNUP-TIMEOUT-PROBE-002: 504 + probe email_not_confirmed → verification_email_sent", async () => {
    auth.signUp.mockResolvedValue({
      data: null,
      error: { message: "Database error finding user", status: 500 },
    });
    auth.signInWithPassword.mockResolvedValue({
      data: null,
      error: { message: "Email not confirmed", status: 400, code: "email_not_confirmed" },
    });

    const result = await signUp(baseInput);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.kind).toBe("verification_email_sent");
  });

  it("SIGNUP-TIMEOUT-PROBE-003: 504 + probe invalid_credentials → service_unavailable (not invalid_credentials)", async () => {
    auth.signUp.mockResolvedValue({
      data: null,
      error: { message: "504 timeout", status: 504 },
    });
    auth.signInWithPassword.mockResolvedValue({
      data: null,
      error: { message: "Invalid login credentials", status: 400, code: "invalid_credentials" },
    });

    const result = await signUp(baseInput);
    expect(result.ok).toBe(false);
    // Critical: a transient sign-up failure MUST NEVER surface as
    // invalid_credentials (would punish the user via failure-policy).
    if (!result.ok) expect(result.error.code).not.toBe("invalid_credentials");
  });

  it("SIGNUP-TIMEOUT-PROBE-004: server email_exists code → account_exists", async () => {
    auth.signUp.mockResolvedValue({
      data: null,
      error: { message: "User already registered", status: 422, code: "email_exists" },
    });

    const result = await signUp(baseInput);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("account_exists");
    // No probe needed when GoTrue tells us directly.
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it("SIGNUP-TIMEOUT-PROBE-005: 504 + probe surfaces account_exists → account_exists", async () => {
    auth.signUp.mockResolvedValue({
      data: null,
      error: { message: "Database error finding user", status: 500 },
    });
    auth.signInWithPassword.mockResolvedValue({
      data: null,
      error: { message: "Email exists", status: 422, code: "email_exists" },
    });

    const result = await signUp(baseInput);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("account_exists");
  });
});
