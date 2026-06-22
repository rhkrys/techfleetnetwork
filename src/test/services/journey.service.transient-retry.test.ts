/**
 * INFRA-PGRST002-RETRY-001 regression: JourneyService.getCompletedCount
 * must transparently recover from a single transient PGRST002 / 5xx blip
 * via retryPostgrest, without emitting an [ERROR] log line (graceful-degrade
 * only fires after retries are exhausted, and only as a [WARN]).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (...args: unknown[]) => mockFrom(...args) },
}));

import { JourneyService } from "@/services/journey.service";

function chainOnce(result: { count?: number | null; error?: { message: string; code?: string; status?: number } | null }) {
  const thenable = Promise.resolve(result);
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    then: (on: (v: unknown) => unknown) => thenable.then(on),
  };
}

describe("JourneyService.getCompletedCount — transient retry recovery (INFRA-PGRST002-RETRY-001)", () => {
  beforeEach(() => {
    mockFrom.mockReset();
  });

  it("recovers from a single PGRST002 blip on the retry attempt", async () => {
    let call = 0;
    mockFrom.mockImplementation(() => {
      call += 1;
      if (call === 1) return chainOnce({ count: null, error: { message: "schema cache miss", code: "PGRST002" } });
      return chainOnce({ count: 7, error: null });
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const out = await JourneyService.getCompletedCount("u1", "first_steps");
    expect(out).toBe(7);
    expect(call).toBeGreaterThanOrEqual(2);
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("recovers from a single 503 blip on the retry attempt", async () => {
    let call = 0;
    mockFrom.mockImplementation(() => {
      call += 1;
      if (call === 1) return chainOnce({ count: null, error: { message: "Service Unavailable", status: 503 } });
      return chainOnce({ count: 3, error: null });
    });
    const out = await JourneyService.getCompletedCount("u1", "core_courses");
    expect(out).toBe(3);
  });
});
