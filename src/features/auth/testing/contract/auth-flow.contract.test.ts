import { describe, expect, it, vi, beforeEach } from "vitest";
import { ClientSessionWriteError } from "@/lib/auth/session-health";

const setSession = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { setSession: (...args: unknown[]) => setSession(...args) } },
}));

beforeEach(() => { setSession.mockReset(); });

const VALID_ACCESS =
  "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ2aWNoZWEifQ.signature_part_base64url";
const OPAQUE_REFRESH = "v1.MzAxYWY3NTQtMmNkNi00YjVjLWJjNzY";

async function importService() {
  const mod = await import("../services/auth-flow.service");
  return mod;
}

describe("auth-flow.service.setSessionSafe — Vichea invariants", () => {
  it("accepts opaque refresh token from GoTrue (the Vichea regression)", async () => {
    setSession.mockResolvedValue({ error: null });
    const { setSessionSafe } = await importService();
    await expect(
      setSessionSafe({ access_token: VALID_ACCESS, refresh_token: OPAQUE_REFRESH }),
    ).resolves.toBeUndefined();
    expect(setSession).toHaveBeenCalledOnce();
  });

  it("rejects an invalid access_token shape with ClientSessionWriteError", async () => {
    const { setSessionSafe } = await importService();
    await expect(
      setSessionSafe({ access_token: "not.a.jwt!", refresh_token: OPAQUE_REFRESH }),
    ).rejects.toBeInstanceOf(ClientSessionWriteError);
    expect(setSession).not.toHaveBeenCalled();
  });

  it("rejects an empty refresh_token with ClientSessionWriteError", async () => {
    const { setSessionSafe } = await importService();
    await expect(
      setSessionSafe({ access_token: VALID_ACCESS, refresh_token: "" }),
    ).rejects.toBeInstanceOf(ClientSessionWriteError);
  });

  it("never applies the JWT shape check to refresh_token", async () => {
    // A refresh token that is NOT a JWT must be accepted.
    setSession.mockResolvedValue({ error: null });
    const { setSessionSafe } = await importService();
    await expect(
      setSessionSafe({ access_token: VALID_ACCESS, refresh_token: "x".repeat(64) }),
    ).resolves.toBeUndefined();
  });

  it("wraps a GoTrue rejection in ClientSessionWriteError (non-punitive)", async () => {
    setSession.mockResolvedValue({ error: { message: "boom" } });
    const { setSessionSafe } = await importService();
    await expect(
      setSessionSafe({ access_token: VALID_ACCESS, refresh_token: OPAQUE_REFRESH }),
    ).rejects.toBeInstanceOf(ClientSessionWriteError);
  });

  it("single-flight: concurrent calls share one in-flight promise", async () => {
    let resolveIt: () => void = () => {};
    setSession.mockReturnValue(new Promise<{ error: null }>((res) => {
      resolveIt = () => res({ error: null });
    }));
    const { setSessionSafe } = await importService();
    const a = setSessionSafe({ access_token: VALID_ACCESS, refresh_token: OPAQUE_REFRESH });
    const b = setSessionSafe({ access_token: VALID_ACCESS, refresh_token: OPAQUE_REFRESH });
    resolveIt();
    await Promise.all([a, b]);
    expect(setSession).toHaveBeenCalledTimes(1);
  });
});
