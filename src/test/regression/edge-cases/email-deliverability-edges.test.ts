// EMAIL-EDGE-007 — idempotency replay: same idem_key = one log row.
// EMAIL-EDGE-005 — missing unsubscribe token on transactional = 400.
// EMAIL-EDGE-006 — frequency cap blast (already covered in incidents/email-frequency-cap).
import { describe, it, expect } from "vitest";

class IdempotencyStore {
  private seen = new Map<string, { status: number; body: unknown }>();
  send(key: string, payload: unknown, perform: () => { status: number; body: unknown }) {
    const prior = this.seen.get(key);
    if (prior) return prior;
    const result = perform();
    this.seen.set(key, result);
    return result;
  }
}

function validateTransactional(p: { lane: string; unsubscribe_token?: string }) {
  if (p.lane !== "auth" && !p.unsubscribe_token) {
    return { ok: false, status: 400, reason: "missing_unsubscribe" };
  }
  return { ok: true, status: 202 };
}

describe("EMAIL-EDGE: deliverability edges", () => {
  it("007 idempotent replay returns same result, no double-send", () => {
    const store = new IdempotencyStore();
    let calls = 0;
    const perform = () => { calls++; return { status: 202, body: { ok: true } }; };
    const a = store.send("key-1", {}, perform);
    const b = store.send("key-1", {}, perform);
    expect(calls).toBe(1);
    expect(a).toEqual(b);
  });

  it("005 transactional without unsubscribe_token → 400", () => {
    expect(validateTransactional({ lane: "transactional" })).toMatchObject({ status: 400 });
  });

  it("005 auth lane bypasses unsubscribe requirement", () => {
    expect(validateTransactional({ lane: "auth" })).toMatchObject({ status: 202 });
  });
});
