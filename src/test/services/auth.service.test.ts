import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthService } from "@/services/auth.service";
import { supabase } from "@/integrations/supabase/client";
import { logAccountActivity } from "@/lib/account-activity";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
      signInWithPassword: vi.fn(),
      signOut: vi.fn(),
      signUp: vi.fn(),
      resetPasswordForEmail: vi.fn(),
      setSession: vi.fn(),
      updateUser: vi.fn(),
      onAuthStateChange: vi.fn(),
    },
    from: vi.fn(),
    rpc: vi.fn(),
    functions: { invoke: vi.fn() },
  },
}));

vi.mock("@/services/logger.service", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    track: (_action: string, _message: string, _meta: unknown, fn: () => unknown) => fn(),
  }),
}));

vi.mock("@/lib/account-activity", () => ({ logAccountActivity: vi.fn() }));

vi.mock("@/lib/email-domain-validation", () => ({
  validateEmailDomainExists: vi.fn().mockResolvedValue({ valid: true }),
}));

const makeSession = (userId: string, issuedAgoMs = 60_000) => ({
  access_token: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.signature",
  refresh_token: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJyZWZyZXNoIn0.signature",
  expires_in: 600,
  expires_at: Math.floor((Date.now() - issuedAgoMs + 600_000) / 1000),
  token_type: "bearer",
  user: {
    id: userId,
    email: `${userId}@example.com`,
    created_at: new Date(Date.now() - 86_400_000).toISOString(),
    last_sign_in_at: new Date(Date.now() - issuedAgoMs).toISOString(),
    app_metadata: {},
    user_metadata: {},
    aud: "authenticated",
  },
});

describe("AuthService session max-age marker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(supabase.auth.getSession).mockReset();
    sessionStorage.clear();
    localStorage.clear();
    vi.mocked(supabase.rpc).mockResolvedValue({ data: false, error: null });
    vi.mocked(supabase.functions.invoke).mockResolvedValue({ data: { valid: true }, error: null });
    vi.mocked(supabase.auth.setSession).mockReset();
    vi.mocked(supabase.auth.signOut).mockResolvedValue({ error: null });
    vi.mocked(supabase.from).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
    } as never);
  });

  it("writes a distinct audit event when an admin signs in", async () => {
    const session = makeSession("admin-user");
    vi.mocked(supabase.functions.invoke).mockResolvedValue({ data: { session, user: session.user }, error: null });
    vi.mocked(supabase.auth.setSession).mockResolvedValue({ data: { session, user: session.user }, error: null });
    vi.mocked(supabase.from).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      then: (resolve: (value: unknown) => void) => resolve({ count: 1, error: null }),
    } as never);
    vi.mocked(supabase.rpc).mockResolvedValue({ data: null, error: null });

    await AuthService.signInWithPassword("admin@example.com", "ValidPass123!", "valid-turnstile-token-with-enough-length");
    await vi.waitFor(() => expect(supabase.rpc).toHaveBeenCalledWith("write_audit_log", expect.objectContaining({
      p_event_type: "authn_admin_login_success",
      p_user_id: "admin-user",
    })));
    expect(logAccountActivity).toHaveBeenCalledWith("login_succeeded", expect.objectContaining({ userId: "admin-user" }));
  });

  it("requires CAPTCHA before any password login auth request", async () => {
    await expect(AuthService.signInWithPassword("admin@example.com", "ValidPass123!")).rejects.toThrow("Complete the human verification");
    expect(supabase.auth.signInWithPassword).not.toHaveBeenCalled();
    expect(supabase.functions.invoke).not.toHaveBeenCalledWith("login-with-captcha", expect.anything());
  });

  it("AUTH-RESET-010: refuses mismatched password updates before backend call", async () => {
    await expect(AuthService.updatePassword({ password: "StrongPass123!", confirmPassword: "StrongPass124!" })).rejects.toThrow(/passwords do not match/i);
    expect(supabase.functions.invoke).not.toHaveBeenCalledWith("update-password-confirmed", expect.anything());
    expect(supabase.auth.updateUser).not.toHaveBeenCalled();
  });

  it("AUTH-RESET-011: updates confirmed recovery passwords without the extra edge-function dependency", async () => {
    vi.mocked(supabase.auth.updateUser).mockResolvedValue({ data: { user: null }, error: null });
    vi.mocked(supabase.functions.invoke).mockResolvedValue({ data: { revocation_recorded: true, gotrue_signed_out: false }, error: null });

    await expect(AuthService.updatePassword({ password: "StrongPass123!", confirmPassword: "StrongPass123!" })).resolves.toEqual({ otherDevicesRevoked: true });

    expect(supabase.auth.updateUser).toHaveBeenCalledWith({ password: "StrongPass123!" });
    expect(supabase.functions.invoke).not.toHaveBeenCalledWith("update-password-confirmed", expect.anything());
    expect(logAccountActivity).toHaveBeenCalledWith("password_updated", { details: { confirmed: true } });
  });

  it("AUTH-RESET-GOOGLE-ONLY-001: blocks Google-only reset before the password reset service", async () => {
    vi.mocked(supabase.functions.invoke).mockResolvedValue({ data: { has_google: true, has_password: false }, error: null });

    await expect(AuthService.resetPassword("google@example.com", "https://techfleet.network/reset-password", "valid-turnstile-token-with-enough-length")).rejects.toThrow(/Google sign-in/i);

    expect(supabase.auth.resetPasswordForEmail).not.toHaveBeenCalled();
    expect(logAccountActivity).toHaveBeenCalledWith("password_reset_google_only_blocked", { email: "google@example.com" });
  });

  it("AUTH-RESET-EMAIL-PASSWORD-001: allows email-password accounts to request a reset", async () => {
    vi.mocked(supabase.functions.invoke).mockResolvedValue({ data: { has_google: false, has_password: true }, error: null });
    vi.mocked(supabase.auth.resetPasswordForEmail).mockResolvedValue({ data: {}, error: null });

    await expect(AuthService.resetPassword("member@example.com", "https://techfleet.network/reset-password", "valid-turnstile-token-with-enough-length")).resolves.toBeUndefined();

    expect(supabase.auth.resetPasswordForEmail).toHaveBeenCalledWith("member@example.com", {
      redirectTo: "https://techfleet.network/reset-password",
      captchaToken: "valid-turnstile-token-with-enough-length",
    });
    expect(logAccountActivity).toHaveBeenCalledWith("password_reset_requested", { email: "member@example.com" });
  });

  it("AUTH-RESET-TRANSIENT-001: treats password update transport failures as service unavailable", async () => {
    vi.mocked(supabase.auth.updateUser).mockResolvedValue({ data: { user: null }, error: { message: "Failed to fetch", status: 0 } });

    await expect(AuthService.updatePassword({ password: "StrongPass123!", confirmPassword: "StrongPass123!" })).rejects.toMatchObject({ code: "service_unavailable" });

    expect(supabase.functions.invoke).not.toHaveBeenCalledWith("update-password-confirmed", expect.anything());
  });

  it("does not sign out a user because another account left a stale timestamp", async () => {
    const session = makeSession("current-user");
    localStorage.setItem("sb-project-auth-token", JSON.stringify({ access_token: session.access_token, refresh_token: session.refresh_token }));
    sessionStorage.setItem("session_started_at", JSON.stringify({ version: 1, userId: "different-user", startedAtMs: Date.now() - 5 * 60 * 60 * 1000 }));
    vi.mocked(supabase.auth.getSession).mockResolvedValue({ data: { session }, error: null });

    await expect(AuthService.getSession()).resolves.toEqual(session);
    expect(supabase.auth.signOut).not.toHaveBeenCalled();
    expect(JSON.parse(sessionStorage.getItem("session_started_at") ?? "{}")).toMatchObject({ userId: "current-user" });
  });

  it("migrates legacy stale numeric timestamps without killing a fresh session", async () => {
    const session = makeSession("legacy-user");
    localStorage.setItem("sb-project-auth-token", JSON.stringify({ access_token: session.access_token, refresh_token: session.refresh_token }));
    sessionStorage.setItem("session_started_at", String(Date.now() - 5 * 60 * 60 * 1000));
    vi.mocked(supabase.auth.getSession).mockResolvedValue({ data: { session }, error: null });

    await expect(AuthService.getSession()).resolves.toEqual(session);
    expect(supabase.auth.signOut).not.toHaveBeenCalled();
    expect(JSON.parse(sessionStorage.getItem("session_started_at") ?? "{}")).toMatchObject({ userId: "legacy-user" });
  });

  it("still expires the same user's genuinely over-age session", async () => {
    const session = makeSession("expired-user", 5 * 60 * 60 * 1000);
    localStorage.setItem("sb-project-auth-token", JSON.stringify({ access_token: session.access_token, refresh_token: session.refresh_token }));
    sessionStorage.setItem(
      "session_started_at",
      JSON.stringify({ version: 1, userId: "expired-user", startedAtMs: Date.now() - 5 * 60 * 60 * 1000 }),
    );
    vi.mocked(supabase.auth.getSession).mockResolvedValue({ data: { session }, error: null });

    await expect(AuthService.getSession()).resolves.toBeNull();
    expect(supabase.auth.signOut).toHaveBeenCalledOnce();
  });

  it("expires the same user's stale idle marker before reusing a stored session", async () => {
    const session = makeSession("idle-user");
    localStorage.setItem("sb-project-auth-token", JSON.stringify({ access_token: session.access_token, refresh_token: session.refresh_token }));
    sessionStorage.setItem(
      "session_started_at",
      JSON.stringify({ version: 1, userId: "idle-user", startedAtMs: Date.now() - 3 * 60 * 60 * 1000, lastActivityAtMs: Date.now() - 2 * 60 * 60 * 1000 }),
    );
    vi.mocked(supabase.auth.getSession).mockResolvedValue({ data: { session }, error: null });

    await expect(AuthService.getSession()).resolves.toBeNull();
    expect(supabase.auth.signOut).toHaveBeenCalledOnce();
    expect(logAccountActivity).toHaveBeenCalledWith("session_idle_timeout", expect.objectContaining({ userId: "idle-user" }));
  });

  it("does NOT sign out an active user even when the in-tab marker is stale", async () => {
    // Real user-activity timestamp (cross-tab, written by session-activity tracker)
    // is fresh — must override the stale per-tab marker.
    const session = makeSession("active-user");
    localStorage.setItem("sb-project-auth-token", JSON.stringify({ access_token: session.access_token, refresh_token: session.refresh_token }));
    localStorage.setItem("tfn:last-activity-at", String(Date.now() - 30_000));
    sessionStorage.setItem(
      "session_started_at",
      JSON.stringify({ version: 1, userId: "active-user", startedAtMs: Date.now() - 3 * 60 * 60 * 1000, lastActivityAtMs: Date.now() - 2 * 60 * 60 * 1000 }),
    );
    vi.mocked(supabase.auth.getSession).mockResolvedValue({ data: { session }, error: null });

    await expect(AuthService.getSession()).resolves.toEqual(session);
    expect(supabase.auth.signOut).not.toHaveBeenCalled();
  });

  it("does not call the backend when no auth token is stored locally", async () => {
    await expect(AuthService.getSession()).resolves.toBeNull();
    expect(supabase.auth.getSession).not.toHaveBeenCalled();
  });

  it("blocks direct OAuth callback URLs unless OAuth was initiated from the UI", async () => {
    window.history.replaceState({}, "", "/?code=direct-oauth-code");

    await expect(AuthService.getSession()).resolves.toBeNull();
    expect(supabase.auth.getSession).not.toHaveBeenCalled();
    expect(window.location.search).toBe("");
  });

  it("clears local auth state when the stored refresh token has been rotated away", async () => {
    localStorage.setItem("sb-project-auth-token", JSON.stringify({ refresh_token: "missing-refresh-token" }));
    sessionStorage.setItem("session_started_at", JSON.stringify({ version: 1, userId: "user", startedAtMs: Date.now() }));
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: null },
      error: { message: "Invalid Refresh Token: Refresh Token Not Found", status: 400 },
    });

    await expect(AuthService.getSession()).resolves.toBeNull();
    expect(localStorage.getItem("sb-project-auth-token")).toBeNull();
    expect(sessionStorage.getItem("session_started_at")).toBeNull();
    expect(supabase.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("recovers when the auth client throws an invalid refresh token error instead of returning one", async () => {
    localStorage.setItem("sb-project-auth-token", JSON.stringify({ refresh_token: "rotated-refresh-token" }));
    sessionStorage.setItem("sb-project-auth-token", JSON.stringify({ refresh_token: "duplicate-stale-token" }));
    sessionStorage.setItem("session_started_at", JSON.stringify({ version: 1, userId: "user", startedAtMs: Date.now() }));
    vi.mocked(supabase.auth.getSession).mockRejectedValue(new Error("Invalid Refresh Token: refresh token already used"));

    await expect(AuthService.getSession()).resolves.toBeNull();
    expect(localStorage.getItem("sb-project-auth-token")).toBeNull();
    expect(sessionStorage.getItem("sb-project-auth-token")).toBeNull();
    expect(sessionStorage.getItem("session_started_at")).toBeNull();
    expect(supabase.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });
});