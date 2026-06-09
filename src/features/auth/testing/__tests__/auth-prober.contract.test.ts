import { describe, it, expect, vi } from "vitest";
import { runAuthProbe, shouldPage, PROBER_USER_AGENT } from "../auth-prober";

const okResponse = (body: Record<string, unknown> = { ok: true }) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

describe("auth-prober contract", () => {
  it("sends PROBER_USER_AGENT on every request", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse());
    await runAuthProbe({
      brokerUrl: "https://example.com/auth-broker",
      testEmail: "prober@example.com",
      temporaryPassword: "tmp",
      authHeader: "Bearer test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    for (const call of fetchImpl.mock.calls) {
      const [, init] = call as [string, RequestInit];
      const headers = init.headers as Record<string, string>;
      expect(headers["user-agent"]).toBe(PROBER_USER_AGENT);
    }
  });

  it("returns one result per stage and marks reset_complete skipped", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse());
    const results = await runAuthProbe({
      brokerUrl: "https://example.com/auth-broker",
      testEmail: "prober@example.com",
      temporaryPassword: "tmp",
      authHeader: "Bearer test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const stages = results.map((r) => r.stage);
    expect(stages).toEqual(["reset_request", "reset_complete", "sign_in", "sign_out"]);
    expect(results[1].outcome).toBe("skipped");
  });

  it("shouldPage fires only on two-strike same-stage failure", () => {
    const prior = [{ stage: "sign_in" as const, outcome: "err" as const, latencyMs: 1, correlationId: "a" }];
    const latest = [{ stage: "sign_in" as const, outcome: "err" as const, latencyMs: 1, correlationId: "b" }];
    expect(shouldPage(latest, prior)).toBe(true);
    expect(shouldPage(latest, null)).toBe(false);
    expect(shouldPage([{ ...latest[0], outcome: "ok" }], prior)).toBe(false);
  });
});
