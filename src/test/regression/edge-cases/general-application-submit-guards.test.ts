// GENAPP-EDGE-006 — duplicate submission prevented.
// GENAPP-EDGE-015 — idempotent resubmit via idempotency key.
import { describe, it, expect } from "vitest";

class SubmitGuard {
  private inflight = new Set<string>();
  async submit(id: string, work: () => Promise<{ ok: boolean }>) {
    if (this.inflight.has(id)) return { ok: false, duplicate: true };
    this.inflight.add(id);
    try { return await work(); } finally { this.inflight.delete(id); }
  }
}

describe("GENAPP-EDGE: general application submit guards", () => {
  it("006 duplicate concurrent submit returns duplicate", async () => {
    const g = new SubmitGuard();
    let calls = 0;
    const work = () => new Promise<{ ok: boolean }>((r) => {
      calls++;
      setTimeout(() => r({ ok: true }), 20);
    });
    const [a, b] = await Promise.all([g.submit("x", work), g.submit("x", work)]);
    expect(calls).toBe(1);
    expect([a, b].some((r) => (r as { duplicate?: boolean }).duplicate)).toBe(true);
  });

  it("015 same idempotency key replays return identical result", () => {
    const cache = new Map<string, unknown>();
    const send = (k: string, body: unknown) => {
      if (cache.has(k)) return cache.get(k);
      cache.set(k, { status: 201, body });
      return cache.get(k);
    };
    expect(send("idem-1", { v: 1 })).toEqual(send("idem-1", { v: 1 }));
  });
});
