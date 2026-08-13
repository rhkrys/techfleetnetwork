// Tests for src/services/handoff.service.ts — the client service for the Hand-Off Production System.
import { describe, expect, it, vi, beforeEach } from "vitest";

// Control the edge invoker + supabase client for this module under test.
const invokeEdge = vi.fn();
vi.mock("@/lib/edge/invokeEdge", () => ({ invokeEdge: (...a: unknown[]) => invokeEdge(...a) }));

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpc(...a),
    from: () => ({
      select: () => ({
        eq: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }),
      }),
    }),
  },
}));

import {
  activeStageIndex,
  budgetState,
  getCompleteness,
  getDownloadUrl,
  isTerminalStatus,
  produceHandoffs,
  submitText,
} from "@/services/handoff.service";

beforeEach(() => {
  invokeEdge.mockReset();
  rpc.mockReset();
});

describe("isTerminalStatus", () => {
  it("treats complete/failed/canceled as terminal, working states as not", () => {
    expect(isTerminalStatus("complete")).toBe(true);
    expect(isTerminalStatus("failed")).toBe(true);
    expect(isTerminalStatus("canceled")).toBe(true);
    for (const s of ["queued", "parsing", "extracting", "writing", "rendering"]) {
      expect(isTerminalStatus(s)).toBe(false);
    }
    expect(isTerminalStatus(null)).toBe(false);
  });
});

describe("activeStageIndex", () => {
  it("maps run statuses onto the five-stage bar (complete = Review)", () => {
    expect(activeStageIndex("queued")).toBe(0);
    expect(activeStageIndex("extracting")).toBe(1);
    expect(activeStageIndex("writing")).toBe(3);
    expect(activeStageIndex("rendering")).toBe(3);
    expect(activeStageIndex("complete")).toBe(4);
    expect(activeStageIndex("failed")).toBe(-1);
    expect(activeStageIndex(null)).toBe(0);
  });
});

describe("budgetState", () => {
  it("gives one production then exactly one team retry", () => {
    expect(budgetState(0)).toMatchObject({
      can_produce: true,
      can_retry: false,
      retries_remaining: 0,
    });
    expect(budgetState(1)).toMatchObject({
      can_produce: false,
      can_retry: true,
      retries_remaining: 1,
    });
    expect(budgetState(2)).toMatchObject({
      can_produce: false,
      can_retry: false,
      retries_remaining: 0,
    });
  });
});

describe("getCompleteness", () => {
  it("returns the RPC payload and throws on error", async () => {
    rpc.mockResolvedValueOnce({
      data: { total: 26, completed: 26, progress_pct: 100, is_ready: true, components: [] },
      error: null,
    });
    const g = await getCompleteness("p1", "phase_1");
    expect(rpc).toHaveBeenCalledWith("handoff_completeness", {
      p_project_id: "p1",
      p_phase: "phase_1",
    });
    expect(g.is_ready).toBe(true);

    rpc.mockResolvedValueOnce({ data: null, error: new Error("permission denied") });
    await expect(getCompleteness("p1", "phase_1")).rejects.toThrow("permission denied");
  });
});

describe("submission + production calls target the right edge functions", () => {
  it("submitText sends a text submission to handoff-submit", async () => {
    await submitText("p1", "phase_1", "pre-amble", "hello");
    expect(invokeEdge).toHaveBeenCalledWith("handoff-submit", {
      body: {
        project_id: "p1",
        phase: "phase_1",
        component_slug: "pre-amble",
        type: "text",
        text: "hello",
      },
    });
  });

  it("produceHandoffs posts project+phase to handoff-produce", async () => {
    await produceHandoffs("p1", "phase_2");
    expect(invokeEdge).toHaveBeenCalledWith("handoff-produce", {
      body: { project_id: "p1", phase: "phase_2" },
    });
  });

  it("getDownloadUrl requests a signed URL by output_file_id", async () => {
    await getDownloadUrl("out-1");
    expect(invokeEdge).toHaveBeenCalledWith("handoff-download", {
      body: { output_file_id: "out-1" },
    });
  });
});
