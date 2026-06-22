/**
 * rpc-with-timeout unit tests.
 * Covers ADMIN-2FA-TIMEOUT-001..002 and DISCORD-RETRY-TIMEOUT-001 root-cause fix.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...a: unknown[]) => rpcMock(...a) },
}));

import { rpcWithTimeout } from "@/lib/db/rpc-with-timeout";

describe("rpcWithTimeout", () => {
  beforeEach(() => { rpcMock.mockReset(); });

  it("resolves passthrough when RPC succeeds", async () => {
    rpcMock.mockResolvedValueOnce({ data: 42, error: null });
    const out = await rpcWithTimeout<number>("foo", { x: 1 });
    expect(out).toEqual({ data: 42, error: null });
  });

  it("returns RPC_TIMEOUT error when the call exceeds timeoutMs", async () => {
    rpcMock.mockReturnValue(new Promise(() => { /* never resolves */ }));
    const out = await rpcWithTimeout("hang", {}, { timeoutMs: 20, retryOnTimeout: false });
    expect(out.data).toBeNull();
    expect(out.error?.code).toBe("RPC_TIMEOUT");
  });

  it("retries once on timeout when retryOnTimeout=true", async () => {
    rpcMock
      .mockReturnValueOnce(new Promise(() => { /* hang */ }))
      .mockResolvedValueOnce({ data: "ok", error: null });
    const out = await rpcWithTimeout<string>("retry", {}, { timeoutMs: 15, retryOnTimeout: true });
    expect(out.data).toBe("ok");
    expect(rpcMock).toHaveBeenCalledTimes(2);
  });

  it("normalizes thrown errors into the result shape", async () => {
    rpcMock.mockRejectedValueOnce(new Error("boom"));
    const out = await rpcWithTimeout("throws", {}, { timeoutMs: 50, retryOnTimeout: false });
    expect(out.data).toBeNull();
    expect(out.error?.message).toContain("boom");
  });
});
