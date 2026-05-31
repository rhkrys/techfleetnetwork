// Regression: transactional email sends rejected `missing_unsubscribe` token (10 occ).
// Lock in: payload validator requires unsubscribe_token unless lane=auth.
import { describe, it, expect } from "vitest";

type Payload = { lane: string; unsubscribe_token?: string };

function validatePayload(p: Payload): { ok: boolean; reason?: string } {
  if (p.lane === "auth") return { ok: true };
  if (!p.unsubscribe_token) return { ok: false, reason: "missing_unsubscribe" };
  return { ok: true };
}

describe("incident: missing_unsubscribe guard", () => {
  it("rejects transactional send without token", () => {
    expect(validatePayload({ lane: "transactional" })).toEqual({
      ok: false,
      reason: "missing_unsubscribe",
    });
  });

  it("allows transactional with token", () => {
    expect(validatePayload({ lane: "transactional", unsubscribe_token: "abc" }).ok).toBe(true);
  });

  it("auth lane is exempt", () => {
    expect(validatePayload({ lane: "auth" }).ok).toBe(true);
  });
});
