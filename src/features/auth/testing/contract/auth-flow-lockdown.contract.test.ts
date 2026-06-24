import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * AUTH-FLOW-LOCKDOWN — frozen-auth regression suite (epic 01, wave 1).
 *
 * The auth layer is treated as FROZEN (see migration handoff + auth-flow
 * lockdown rules). These are CHARACTERIZATION tests: they assert the CURRENT
 * typed contract of every member-facing auth flow so a future edit that
 * changes the observable behavior fails CI instead of reaching members.
 *
 * Context: `failed_login_attempts` shows ~55 real members hit repeated login
 * failures the week of 2026-06-01 (the migration/auth incident). No test gate
 * guarded these flows at the time. This file is that gate.
 *
 * Each flow returns `Result<AuthOk, AuthErr>` — no throws cross the boundary
 * — so every test asserts on `result.ok` + `value.kind` / `error.code`.
 *
 * Coverage (this file): the six deterministic flow functions.
 *   AUTH-LOCKDOWN-01  sign-in (password)
 *   AUTH-LOCKDOWN-02  sign-up
 *   AUTH-LOCKDOWN-03  request password reset
 *   AUTH-LOCKDOWN-04  complete password reset
 *   AUTH-LOCKDOWN-05  consume recovery link
 *   AUTH-LOCKDOWN-06  sign-out (storage purge)
 * Deferred to follow-up stories (not deterministic flow functions yet):
 *   AUTH-LOCKDOWN-07  Google OAuth — routes through the lovable adapter and is
 *                     unwired until cutover; characterize once it lands here.
 *   AUTH-LOCKDOWN-08  MFA challenge — lives in auth-mfa.service; own story.
 */

// Telemetry beacons hit supabase.rpc("record_event"); neutralize them so the
// flows run offline and deterministically.
vi.mock("../../services/auth-telemetry", () => ({
  emitAuthBeacon: vi.fn().mockResolvedValue(undefined),
  newCorrelationId: () => "test-correlation-id",
}));

// The sign-in flow's job is to map the service result/throw onto AuthResult.
// The service internals are covered by sign-in.service.test.ts; here we mock
// it so the flow's mapping contract is isolated.
vi.mock("../../services/sign-in.service", () => ({
  signInWithPasswordService: vi.fn(),
}));

// sign-out delegates GoTrue revocation + storage purge to these.
vi.mock("../../services/auth-flow.service", () => ({
  signOutSafe: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../services/auth-storage.service", () => ({
  purgeAuthOwnedStorage: vi.fn(),
}));

// Flows that call GoTrue directly.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      signUp: vi.fn(),
      resetPasswordForEmail: vi.fn(),
      updateUser: vi.fn(),
      exchangeCodeForSession: vi.fn(),
      getSession: vi.fn(),
    },
    rpc: vi.fn(),
    functions: { invoke: vi.fn() },
  },
}));

import { supabase } from "@/integrations/supabase/client";
import { signInWithPasswordService } from "../../services/sign-in.service";
import { signOutSafe } from "../../services/auth-flow.service";
import { purgeAuthOwnedStorage } from "../../services/auth-storage.service";

import { signInWithPassword } from "../../flows/sign-in-password.flow";
import { signUp } from "../../flows/sign-up.flow";
import { requestPasswordReset } from "../../flows/request-password-reset.flow";
import { completePasswordReset } from "../../flows/complete-password-reset.flow";
import { consumeRecoveryLink } from "../../flows/consume-recovery-link.flow";
import { signOut } from "../../flows/sign-out.flow";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AUTH-LOCKDOWN-01 — sign-in (password)", () => {
  it("returns signed_in with the userId on success", async () => {
    vi.mocked(signInWithPasswordService).mockResolvedValue({ user: { id: "user-123" } } as never);

    const result = await signInWithPassword({ email: "m@example.com", password: "x", captchaToken: "tok" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.kind).toBe("signed_in");
      expect((result.value as { userId: string }).userId).toBe("user-123");
    }
  });

  it("maps a server invalid_credentials code to error invalid_credentials", async () => {
    vi.mocked(signInWithPasswordService).mockRejectedValue({ code: "invalid_credentials" });

    const result = await signInWithPassword({ email: "m@example.com", password: "bad", captchaToken: "tok" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_credentials");
  });

  it("maps an HTTP 429 to error rate_limited (no credential punishment)", async () => {
    vi.mocked(signInWithPasswordService).mockRejectedValue({ status: 429 });

    const result = await signInWithPassword({ email: "m@example.com", password: "x", captchaToken: "tok" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("rate_limited");
  });
});

describe("AUTH-LOCKDOWN-02 — sign-up", () => {
  it("returns verification_email_sent on success", async () => {
    vi.mocked(supabase.auth.signUp).mockResolvedValue({ data: {}, error: null } as never);

    const result = await signUp({ email: "new@example.com", password: "StrongPass123!" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.kind).toBe("verification_email_sent");
      expect((result.value as { email: string }).email).toBe("new@example.com");
    }
  });

  it("maps a determinate already-registered error to account_exists", async () => {
    vi.mocked(supabase.auth.signUp).mockResolvedValue({
      data: {},
      error: { status: 400, code: "user_already_exists", message: "User already registered" },
    } as never);

    const result = await signUp({ email: "dupe@example.com", password: "StrongPass123!" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("account_exists");
  });
});

describe("AUTH-LOCKDOWN-03 — request password reset", () => {
  it("returns password_reset_email_sent on success", async () => {
    vi.mocked(supabase.auth.resetPasswordForEmail).mockResolvedValue({ data: {}, error: null } as never);

    const result = await requestPasswordReset({ email: "m@example.com" });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.kind).toBe("password_reset_email_sent");
  });

  it("still returns password_reset_email_sent on a GoTrue error (anti-enumeration invariant)", async () => {
    vi.mocked(supabase.auth.resetPasswordForEmail).mockResolvedValue({
      data: null,
      error: { status: 400, message: "no such user" },
    } as never);

    const result = await requestPasswordReset({ email: "ghost@example.com" });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.kind).toBe("password_reset_email_sent");
  });
});

describe("AUTH-LOCKDOWN-04 — complete password reset", () => {
  it("returns password_updated on success", async () => {
    vi.mocked(supabase.auth.updateUser).mockResolvedValue({ data: { user: { id: "u1" } }, error: null } as never);

    const result = await completePasswordReset({ newPassword: "BrandNewPass123!" });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.kind).toBe("password_updated");
  });

  it("maps a weak_password code to error weak_password", async () => {
    vi.mocked(supabase.auth.updateUser).mockResolvedValue({
      data: { user: null },
      error: { code: "weak_password", message: "Password is too weak" },
    } as never);

    const result = await completePasswordReset({ newPassword: "123" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("weak_password");
  });
});

describe("AUTH-LOCKDOWN-05 — consume recovery link", () => {
  it("establishes the recovery session from a ?code= link", async () => {
    vi.mocked(supabase.auth.exchangeCodeForSession).mockResolvedValue({ data: {}, error: null } as never);

    const result = await consumeRecoveryLink({ url: "https://app.test/reset-password?code=abc123" });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.kind).toBe("password_reset_email_sent");
    expect(supabase.auth.exchangeCodeForSession).toHaveBeenCalledWith("abc123");
  });

  it("maps an otp_expired link to recovery_session_expired without calling GoTrue", async () => {
    const result = await consumeRecoveryLink({
      url: "https://app.test/reset-password?error=access_denied&error_code=otp_expired",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("recovery_session_expired");
    expect(supabase.auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });
});

describe("AUTH-LOCKDOWN-06 — sign-out", () => {
  it("returns signed_out and purges auth-owned storage", async () => {
    const result = await signOut();

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.kind).toBe("signed_out");
    expect(signOutSafe).toHaveBeenCalledTimes(1);
    expect(purgeAuthOwnedStorage).toHaveBeenCalledTimes(1);
  });
});
