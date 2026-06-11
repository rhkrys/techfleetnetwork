import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const setSessionMock = vi.fn();
const signOutMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      setSession: (...args: unknown[]) => setSessionMock(...args),
      signOut: (...args: unknown[]) => signOutMock(...args),
    },
  },
}));

vi.mock("@/services/logger.service", () => ({
  createLogger: () => ({ warn: () => {}, info: () => {}, error: () => {}, debug: () => {} }),
}));

import { setSessionSafe, signOutSafe } from "../auth-flow.service";
import { ClientSessionWriteError } from "@/lib/auth/session-health";

// A realistic JWT shape (3 segments base64url). The payload doesn't need to
// decode — `isLikelyJwt` only checks structural shape.
const VALID_JWT =
  "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.signaturesignaturesignaturesignature";
const VALID_SESSION = { access_token: VALID_JWT, refresh_token: "opaque-refresh-token-12345", user: { id: "user-1" } };

describe("auth-flow.service (Vichea invariants)", () => {
  beforeEach(() => {
    setSessionMock.mockReset();
    signOutMock.mockReset();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("accepts an opaque (non-JWT) refresh token returned by GoTrue", async () => {
    setSessionMock.mockResolvedValue({ data: { session: VALID_SESSION }, error: null });
    await expect(
      setSessionSafe({
        access_token: VALID_JWT,
        // The exact regression: GoTrue refresh tokens are opaque, NOT JWTs.
        refresh_token: "v2.public.abcdefghijklmnopqrstuvwxyz",
      }),
    ).resolves.toMatchObject({ access_token: VALID_JWT });
    expect(setSessionMock).toHaveBeenCalledOnce();
  });

  it("rejects an empty refresh token without calling setSession", async () => {
    await expect(
      setSessionSafe({ access_token: VALID_JWT, refresh_token: "" }),
    ).rejects.toBeInstanceOf(ClientSessionWriteError);
    expect(setSessionMock).not.toHaveBeenCalled();
  });

  it("rejects a malformed access_token without calling setSession", async () => {
    await expect(
      setSessionSafe({ access_token: "not-a-jwt", refresh_token: "v2.public.xyzxyzxyzxyzxyz" }),
    ).rejects.toBeInstanceOf(ClientSessionWriteError);
    expect(setSessionMock).not.toHaveBeenCalled();
  });

  it("single-flights concurrent setSession calls", async () => {
    let resolve!: (v: { data: { session: typeof VALID_SESSION }; error: null }) => void;
    setSessionMock.mockReturnValue(new Promise((r) => { resolve = r; }));
    const a = setSessionSafe({ access_token: VALID_JWT, refresh_token: "opaque-refresh-token-12345" });
    const b = setSessionSafe({ access_token: VALID_JWT, refresh_token: "opaque-refresh-token-12345" });
    resolve({ data: { session: VALID_SESSION }, error: null });
    await Promise.all([a, b]);
    expect(setSessionMock).toHaveBeenCalledOnce();
  });

  it("signOutSafe swallows provider errors (revocation row is authoritative)", async () => {
    signOutMock.mockRejectedValue(new Error("network down"));
    await expect(signOutSafe()).resolves.toBeUndefined();
  });
});
