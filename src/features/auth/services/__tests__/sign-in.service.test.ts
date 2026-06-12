import { beforeEach, describe, expect, it, vi } from "vitest";
import { supabase } from "@/integrations/supabase/client";
import { logAccountActivity } from "@/lib/account-activity";
import { signInWithPasswordService } from "@/features/auth/services/sign-in.service";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
      signInWithPassword: vi.fn(),
      signOut: vi.fn(),
      signUp: vi.fn(),
      signInWithOAuth: vi.fn(),
      resetPasswordForEmail: vi.fn(),
      setSession: vi.fn(),
      updateUser: vi.fn(),
      getUser: vi.fn(),
      onAuthStateChange: vi.fn(),
    },
    from: vi.fn(),
    rpc: vi.fn(),
    functions: { invoke: vi.fn() },
  },
}));

vi.mock("@/services/logger.service", () => ({
  createLogger: () => ({
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
    track: (_a: string, _b: string, _c: unknown, fn: () => unknown) => fn(),
  }),
}));

vi.mock("@/lib/account-activity", () => ({ logAccountActivity: vi.fn() }));

const makeSession = (userId: string) => ({
  access_token: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.signature",
  refresh_token: "opaque-refresh-token",
  expires_in: 600,
  expires_at: Math.floor(Date.now() / 1000) + 600,
  token_type: "bearer",
  user: {
    id: userId,
    email: `${userId}@example.com`,
    created_at: new Date().toISOString(),
    last_sign_in_at: new Date().toISOString(),
    app_metadata: {},
    user_metadata: {},
    aud: "authenticated",
  },
});

describe("sign-in.service — AUTH-DIRECT-SIGNIN-004 (one password-sign-in owner)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();
    vi.mocked(supabase.auth.signInWithPassword).mockReset();
    vi.mocked(supabase.auth.setSession).mockReset();
    vi.mocked(supabase.auth.getUser).mockResolvedValue({ data: { user: { id: "x" } as never }, error: null });
    vi.mocked(supabase.from).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      then: (resolve: (v: unknown) => void) => resolve({ count: 0, error: null }),
    } as never);
    vi.mocked(supabase.rpc).mockResolvedValue({ data: null, error: null });
  });

  it("calls the auth SDK directly with the captcha token (no edge-token handoff)", async () => {
    const session = makeSession("vichea-user");
    vi.mocked(supabase.auth.signInWithPassword).mockResolvedValue({ data: { session, user: session.user }, error: null } as never);

    await expect(
      signInWithPasswordService("vtephang@gmail.com", "ValidPass123!", "valid-turnstile-token-with-enough-length"),
    ).resolves.toMatchObject({ session, user: session.user });

    expect(supabase.auth.signInWithPassword).toHaveBeenCalledWith({
      email: "vtephang@gmail.com",
      password: "ValidPass123!",
      options: { captchaToken: "valid-turnstile-token-with-enough-length" },
    });
    expect(supabase.functions.invoke).not.toHaveBeenCalledWith("login-with-captcha", expect.anything());
    expect(supabase.auth.setSession).not.toHaveBeenCalled();
    expect(logAccountActivity).toHaveBeenCalledWith("login_succeeded", { email: "vtephang@gmail.com", userId: "vichea-user" });
  });

  it("requires CAPTCHA before any password login auth request", async () => {
    await expect(signInWithPasswordService("admin@example.com", "ValidPass123!")).rejects.toThrow("Complete the human verification");
    expect(supabase.auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it("writes admin audit row when an admin signs in", async () => {
    const session = makeSession("admin-user");
    vi.mocked(supabase.auth.signInWithPassword).mockResolvedValue({ data: { session, user: session.user }, error: null } as never);
    vi.mocked(supabase.from).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      then: (resolve: (v: unknown) => void) => resolve({ count: 1, error: null }),
    } as never);

    await signInWithPasswordService("admin@example.com", "ValidPass123!", "valid-turnstile-token-with-enough-length");

    await vi.waitFor(() => expect(supabase.rpc).toHaveBeenCalledWith("write_audit_log", expect.objectContaining({
      p_event_type: "authn_admin_login_success",
      p_user_id: "admin-user",
    })));
  });

  it("maps SDK invalid_credentials to a credential error (no post-success session-write failure)", async () => {
    vi.mocked(supabase.auth.signInWithPassword).mockResolvedValue({
      data: { session: null, user: null },
      error: { message: "Invalid login credentials", status: 400, code: "invalid_credentials" },
    } as never);

    await expect(
      signInWithPasswordService("vtephang@gmail.com", "WrongPass123!", "valid-turnstile-token-with-enough-length"),
    ).rejects.toMatchObject({ code: "invalid_credentials" });
    expect(supabase.auth.setSession).not.toHaveBeenCalled();
  });
});
