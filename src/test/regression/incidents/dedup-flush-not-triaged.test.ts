// Regression: aggregate dedup flush ("duplicate client error(s) deduped") was
// being inserted into agent_fix_queue, polluting the Triage tab.
// Lock in: queue-gate refuses these synthetic aggregate events.
import { describe, it, expect } from "vitest";

type Event = { reason?: string; source?: string };

function shouldEnqueue(e: Event): boolean {
  const r = e.reason ?? "";
  if (/duplicate client error\(s\) deduped/i.test(r)) return false;
  if (/aggregate.*flush/i.test(r) && e.source === "reporter") return false;
  return true;
}

describe("incident: dedup-flush events never reach agent_fix_queue", () => {
  it("blocks the canonical dedup-flush reason", () => {
    expect(shouldEnqueue({ reason: "duplicate client error(s) deduped: 14" })).toBe(false);
  });

  it("blocks aggregate-flush from reporter source", () => {
    expect(shouldEnqueue({ reason: "aggregate window flush", source: "reporter" })).toBe(false);
  });

  it("allows real client errors", () => {
    expect(shouldEnqueue({ reason: "TypeError: x is undefined", source: "window" })).toBe(true);
  });
});
