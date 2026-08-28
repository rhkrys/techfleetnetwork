import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * CohortService.create + update — retry resilience, maybeSingle handling,
 * and additive `schedule` field plumbing.
 *
 * Mirrors class.service.retry.test.ts so both services share one contract.
 */

const insertChain = { insertMock: vi.fn() };
const updateChain = {
  updateMock: vi.fn(),
  eqMock: vi.fn(),
  selectMock: vi.fn(),
};

vi.mock("@/integrations/supabase/client", () => {
  return {
    supabase: {
      from: () => ({
        insert: (payload: unknown) => insertChain.insertMock(payload),
        update: (payload: unknown) => {
          updateChain.updateMock(payload);
          return {
            eq: (col: string, val: string) => {
              updateChain.eqMock(col, val);
              return {
                select: (cols: string) => updateChain.selectMock(cols),
              };
            },
          };
        },
      }),
    },
  };
});

vi.mock("@/lib/auth/session-port", () => ({
  getUserSafe: vi.fn().mockResolvedValue(null),
}));

import { CohortService } from "@/services/cohort.service";

function buildInsertChain(result: { data: unknown; error: unknown }) {
  return {
    select: () => ({
      maybeSingle: () => Promise.resolve(result),
    }),
  };
}

const validValues = {
  label: "Spring 2026",
  start_date: "2026-03-01",
  end_date: "2026-04-30",
  registration_url: "https://techfleet.gumroad.com/l/course",
  meeting_url: "",
  timezone: "America/New_York",
  capacity: null,
  schedule: "<p>Mondays 6pm</p>",
};

beforeEach(() => {
  insertChain.insertMock.mockReset();
  updateChain.updateMock.mockReset();
  updateChain.eqMock.mockReset();
  updateChain.selectMock.mockReset();
});

describe("CohortService.create", () => {
  it("retries on transient PGRST002 then succeeds", async () => {
    insertChain.insertMock
      .mockReturnValueOnce(buildInsertChain({ data: null, error: { message: "schema cache miss", code: "PGRST002" } }))
      .mockReturnValueOnce(buildInsertChain({ data: { id: "c1" }, error: null }));

    const id = await CohortService.create("class-1", validValues);
    expect(id).toBe("c1");
    expect(insertChain.insertMock).toHaveBeenCalledTimes(2);
  }, 10_000);

  it("does NOT retry on RLS denial (42501)", async () => {
    insertChain.insertMock.mockReturnValue(
      buildInsertChain({ data: null, error: { message: "permission denied", code: "42501" } })
    );
    await expect(CohortService.create("class-1", validValues)).rejects.toMatchObject({ code: "42501" });
    expect(insertChain.insertMock).toHaveBeenCalledTimes(1);
  });

  it("throws explicit message when insert returns no row (silent RLS hide)", async () => {
    insertChain.insertMock.mockReturnValue(buildInsertChain({ data: null, error: null }));
    await expect(CohortService.create("class-1", validValues)).rejects.toThrow(/not created/i);
  });

  it("forwards the schedule field in the insert payload", async () => {
    insertChain.insertMock.mockReturnValue(buildInsertChain({ data: { id: "c2" }, error: null }));
    await CohortService.create("class-1", validValues);
    const payload = insertChain.insertMock.mock.calls[0][0] as { schedule: string; class_id: string };
    expect(payload.schedule).toBe("<p>Mondays 6pm</p>");
    expect(payload.class_id).toBe("class-1");
  });

  it("defaults missing schedule to empty string (additive backcompat)", async () => {
    insertChain.insertMock.mockReturnValue(buildInsertChain({ data: { id: "c3" }, error: null }));
    const { schedule: _omit, ...without } = validValues;
    void _omit;
    await CohortService.create("class-1", without as typeof validValues);
    const payload = insertChain.insertMock.mock.calls[0][0] as { schedule: string };
    expect(payload.schedule).toBe("");
  });
});

describe("CohortService.update", () => {
  it("retries on transient upstream timeout then succeeds", async () => {
    updateChain.selectMock
      .mockResolvedValueOnce({ data: null, error: { message: "upstream request timeout" } })
      .mockResolvedValueOnce({ data: [{ id: "c1" }], error: null });

    await CohortService.update("c1", { schedule: "<p>x</p>" });
    expect(updateChain.updateMock).toHaveBeenCalledTimes(2);
  }, 10_000);

  it("converts empty meeting_url to null in the payload", async () => {
    updateChain.selectMock.mockResolvedValue({ data: [{ id: "c1" }], error: null });
    await CohortService.update("c1", { meeting_url: "" });
    const payload = updateChain.updateMock.mock.calls[0][0] as { meeting_url: string | null };
    expect(payload.meeting_url).toBeNull();
  });
});

describe("CohortService — member discount registration link", () => {
  it("includes discount_registration_url in the insert payload", async () => {
    // The insert lists columns explicitly, so a new column is silently dropped
    // unless it is added there. This is the regression guard for that.
    insertChain.insertMock.mockReturnValue(buildInsertChain({ data: { id: "c4" }, error: null }));
    await CohortService.create("class-1", {
      ...validValues,
      discount_registration_url: "https://techfleet.gumroad.com/l/course/tfmember",
    } as typeof validValues);
    const payload = insertChain.insertMock.mock.calls[0][0] as {
      discount_registration_url: string | null;
    };
    expect(payload.discount_registration_url).toBe("https://techfleet.gumroad.com/l/course/tfmember");
  });

  it("converts an empty discount link to null on create", async () => {
    // '' would violate the Gumroad CHECK constraint, which permits NULL or an
    // allowlisted URL and nothing else.
    insertChain.insertMock.mockReturnValue(buildInsertChain({ data: { id: "c5" }, error: null }));
    await CohortService.create("class-1", {
      ...validValues,
      discount_registration_url: "",
    } as typeof validValues);
    const payload = insertChain.insertMock.mock.calls[0][0] as {
      discount_registration_url: string | null;
    };
    expect(payload.discount_registration_url).toBeNull();
  });

  it("converts an empty discount link to null on update", async () => {
    updateChain.selectMock.mockResolvedValue({ data: [{ id: "c1" }], error: null });
    await CohortService.update("c1", { discount_registration_url: "" });
    const payload = updateChain.updateMock.mock.calls[0][0] as {
      discount_registration_url: string | null;
    };
    expect(payload.discount_registration_url).toBeNull();
  });
});
