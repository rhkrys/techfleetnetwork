// Regression: Zod validation failures (validation_rejected) must stay in audit_log
// and never enter agent_fix_queue. Lock in: queue-gate predicate refuses them.
import { describe, it, expect } from "vitest";

type Event = { reason?: string; severity?: string; source?: string };

function shouldEnqueue(e: Event): boolean {
  if (!e.reason) return true;
  if (/^validation_rejected/.test(e.reason)) return false;
  if (/^duplicate client error\(s\) deduped/.test(e.reason)) return false;
  if (/^email_queue\.rate_limited/.test(e.reason)) return false;
  if (/^invalid_refresh_token_cleared/.test(e.reason)) return false;
  return true;
}

describe("incident: validation_rejected never reaches agent_fix_queue", () => {
  it("blocks Zod rejection events at the gate", () => {
    expect(shouldEnqueue({ reason: "validation_rejected:body.email" })).toBe(false);
  });

  it("blocks bare validation_rejected", () => {
    expect(shouldEnqueue({ reason: "validation_rejected" })).toBe(false);
  });

  it("allows genuine runtime errors through", () => {
    expect(shouldEnqueue({ reason: "TypeError: Cannot read x" })).toBe(true);
  });

  it("allows events with no reason (default-enqueue)", () => {
    expect(shouldEnqueue({})).toBe(true);
  });
});
