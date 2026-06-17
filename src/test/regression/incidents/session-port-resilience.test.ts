/**
 * AUTH-RESILIENCE-001..006 — session-port regression tests.
 *
 * Locks in the contract that:
 *   - getSessionSafe NEVER throws (transient backend errors return null)
 *   - getUserSafe retries with jitter on transient bad_jwt where the stored
 *     token is still structurally valid + unexpired, then returns null
 *     without purging the session
 *   - signOutSafe always purges local storage even when the backend errors,
 *     and never throws
 *
 * These tests stand in for the 2026-06-15..17 incident class: a transient
 * GoTrue hiccup must not bounce a logged-in member to /login.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getUser: vi.fn(),
      signOut: vi.fn(),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    },
  },
}));

vi.mock("@/lib/cached-session", () => ({
  getCachedSession: vi.fn(),
  invalidateCachedSession: vi.fn(),
}));

vi.mock("@/lib/auth/session-health", () => ({
  classifyAuthError: vi.fn((err: unknown) => {
    const msg = String((err as { message?: string } | null)?.message ?? err ?? "").toLowerCase();
    if (msg.includes("bad_jwt") || msg.includes("invalid number of segments")) return "jwt_corrupt";
    if (msg.includes("refresh token")) return "refresh_invalid";
    return "ok";
  }),
  decidePurgeOnBadJwt: vi.fn(() => ({ shouldPurge: false, reason: "transient", health: { state: "valid", expSeconds: 9999999999 } })),
  purgeLocalAuthState: vi.fn(),
  clearTransientStrike: vi.fn(),
}));

import { supabase } from "@/integrations/supabase/client";
import { getCachedSession, invalidateCachedSession } from "@/lib/cached-session";
import { decidePurgeOnBadJwt, purgeLocalAuthState } from "@/lib/auth/session-health";
import { getSessionSafe, getUserSafe, signOutSafe } from "@/lib/auth/session-port";

const getCachedSessionMock = vi.mocked(getCachedSession);
const getUserMock = vi.mocked(supabase.auth.getUser);
const signOutMock = vi.mocked(supabase.auth.signOut);
const decidePurgeMock = vi.mocked(decidePurgeOnBadJwt);
const purgeMock = vi.mocked(purgeLocalAuthState);
const invalidateMock = vi.mocked(invalidateCachedSession);

beforeEach(() => {
  vi.clearAllMocks();
  // Default: stored token still looks valid — transient bad_jwt MUST NOT purge.
  decidePurgeMock.mockReturnValue({
    shouldPurge: false,
    reason: "transient",
    health: { state: "valid", expSeconds: 9999999999 },
  });
});

describe("AUTH-RESILIENCE-001 — getSessionSafe never throws", () => {
  it("returns null when cached-session read throws (transient backend hiccup)", async () => {
    getCachedSessionMock.mockRejectedValueOnce(new Error("network timeout"));
    await expect(getSessionSafe()).resolves.toBeNull();
  });

  it("returns the cached session on success", async () => {
    const fake = { access_token: "tok", user: { id: "u1" } } as never;
    getCachedSessionMock.mockResolvedValueOnce(fake);
    await expect(getSessionSafe()).resolves.toBe(fake);
  });
});

describe("AUTH-RESILIENCE-002 — getUserSafe retries transient bad_jwt without purge", () => {
  it("retries on transient bad_jwt + valid stored token, then succeeds", async () => {
    getUserMock
      .mockResolvedValueOnce({ data: { user: null }, error: { message: "bad_jwt: invalid number of segments" } } as never)
      .mockResolvedValueOnce({ data: { user: { id: "u42" } }, error: null } as never);
    const user = await getUserSafe();
    expect(user).toEqual({ id: "u42" });
    expect(getUserMock).toHaveBeenCalledTimes(2);
    // CRITICAL: a transient bad_jwt MUST NOT call the purger.
    expect(purgeMock).not.toHaveBeenCalled();
  });

  it("returns null without purging when retries exhaust on transient errors", async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: { message: "bad_jwt" } } as never);
    const user = await getUserSafe();
    expect(user).toBeNull();
    expect(purgeMock).not.toHaveBeenCalled();
  });
});

describe("AUTH-RESILIENCE-003 — signOutSafe is bullet-proof", () => {
  it("purges local storage and invalidates cache even when backend signOut throws", async () => {
    signOutMock.mockRejectedValueOnce(new Error("network down"));
    await expect(signOutSafe({ scope: "local", reason: "profile_update" })).resolves.toBeUndefined();
    expect(purgeMock).toHaveBeenCalledTimes(1);
    expect(invalidateMock).toHaveBeenCalledTimes(1);
  });

  it("defaults to global scope and succeeds on backend success", async () => {
    signOutMock.mockResolvedValueOnce({ error: null } as never);
    await signOutSafe({ reason: "user_initiated" });
    expect(signOutMock).toHaveBeenCalledWith({ scope: "global" });
  });
});

describe("AUTH-RESILIENCE-004 — decidePurgeOnBadJwt is the only authority", () => {
  it("when decidePurgeOnBadJwt says purge, getUserSafe still returns null but never calls purge directly", async () => {
    // session-port delegates the purge decision back to AuthContext bootstrap;
    // it does NOT purge from inside read paths. Verify the contract.
    decidePurgeMock.mockReturnValue({ shouldPurge: true, reason: "second_strike", health: { state: "valid", expSeconds: 1 } });
    getUserMock.mockResolvedValue({ data: { user: null }, error: { message: "bad_jwt" } } as never);
    const user = await getUserSafe();
    expect(user).toBeNull();
    expect(purgeMock).not.toHaveBeenCalled();
  });
});
