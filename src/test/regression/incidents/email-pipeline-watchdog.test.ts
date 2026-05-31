// Regression: interview-invite / announcement / recovery lanes silently stuck_pending.
// Lock in: watchdog flags lanes with stuck_pending >= threshold for the digest, never push.
import { describe, it, expect } from "vitest";

type LaneStats = { lane: string; stuck_pending: number };

function watchdog(stats: LaneStats[], threshold = 1): {
  digestEvents: string[];
  pushEvents: string[];
} {
  const digestEvents = stats
    .filter((s) => s.stuck_pending >= threshold)
    .map((s) => `${s.lane} email pipeline degraded — stuck_pending`);
  return { digestEvents, pushEvents: [] }; // watchdog never pushes; digest only
}

describe("incident: email pipeline watchdog", () => {
  it("emits digest events for stuck lanes", () => {
    const r = watchdog([
      { lane: "interview-invite", stuck_pending: 1 },
      { lane: "announcement", stuck_pending: 3 },
      { lane: "recovery", stuck_pending: 0 },
    ]);
    expect(r.digestEvents).toHaveLength(2);
    expect(r.digestEvents[0]).toMatch(/interview-invite/);
    expect(r.digestEvents[1]).toMatch(/announcement/);
  });

  it("never enqueues push events (dedupe by design)", () => {
    const r = watchdog([{ lane: "announcement", stuck_pending: 99 }]);
    expect(r.pushEvents).toHaveLength(0);
  });

  it("respects threshold", () => {
    const r = watchdog([{ lane: "x", stuck_pending: 0 }], 1);
    expect(r.digestEvents).toHaveLength(0);
  });
});
