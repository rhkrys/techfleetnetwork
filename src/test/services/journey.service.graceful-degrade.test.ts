/**
 * TRIAGE-NOISE-015 regression: JourneyService.getCompletedCount must
 * graceful-degrade to 0 on transient PostgREST/HTTP failures and re-throw
 * on structural ones.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
  },
}));

import { JourneyService } from "@/services/journey.service";

function chain(result: { count?: number | null; error?: { message: string; code?: string; status?: number } | null }) {
  const thenable = Promise.resolve(result);
  const obj = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    then: (onFulfilled: (v: unknown) => unknown) => thenable.then(onFulfilled),
  };
  return obj;
}

describe("JourneyService.getCompletedCount graceful-degrade (TRIAGE-NOISE-015)", () => {
  beforeEach(() => {
    mockFrom.mockReset();
  });

  it("returns 0 on a transient 503 instead of throwing", async () => {
    mockFrom.mockReturnValue(chain({ count: null, error: { message: "Service Unavailable", status: 503 } }));
    const out = await JourneyService.getCompletedCount("u1", "first_steps");
    expect(out).toBe(0);
  });

  it("returns 0 on a transient PostgREST connection code", async () => {
    mockFrom.mockReturnValue(chain({ count: null, error: { message: "service error", code: "PGRST002" } }));
    const out = await JourneyService.getCompletedCount("u1", "first_steps");
    expect(out).toBe(0);
  });

  it("re-throws on a structural error (RLS denial)", async () => {
    mockFrom.mockReturnValue(chain({ count: null, error: { message: "permission denied", code: "42501" } }));
    await expect(
      JourneyService.getCompletedCount("u1", "first_steps"),
    ).rejects.toThrow(/Failed to count progress/);
  });

  it("returns the count on success", async () => {
    mockFrom.mockReturnValue(chain({ count: 7, error: null }));
    const out = await JourneyService.getCompletedCount("u1", "first_steps");
    expect(out).toBe(7);
  });
});
