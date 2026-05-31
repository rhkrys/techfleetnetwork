// SPB-EDGE-001/002/003 — StepProgressBar state derivation.
import { describe, it, expect } from "vitest";

type StepState = "completed" | "active" | "started" | "todo";
function deriveState(stepIdx: number, currentIdx: number, completedIdxs: number[]): StepState {
  if (completedIdxs.includes(stepIdx)) return "completed";
  if (stepIdx === currentIdx) return "active";
  if (stepIdx < currentIdx) return "started";
  return "todo";
}

describe("SPB-EDGE: step progress bar", () => {
  it("001 active step is marked active", () => {
    expect(deriveState(2, 2, [0, 1])).toBe("active");
  });

  it("002 completed step has completed state", () => {
    expect(deriveState(0, 2, [0, 1])).toBe("completed");
  });

  it("003 started-but-incomplete is 'started'", () => {
    expect(deriveState(1, 3, [])).toBe("started");
  });

  it("future step is todo", () => {
    expect(deriveState(5, 1, [])).toBe("todo");
  });
});
