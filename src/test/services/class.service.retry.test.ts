import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock supabase client BEFORE importing the service.
const insertChain = {
  insertMock: vi.fn(),
};

vi.mock("@/integrations/supabase/client", () => {
  return {
    supabase: {
      from: () => ({
        insert: (payload: unknown) => insertChain.insertMock(payload),
      }),
    },
  };
});

vi.mock("../../services/class-emails", () => ({ sendClassStatusEmails: vi.fn() }));

import { ClassService } from "@/services/class.service";

function buildChain(result: { data: unknown; error: unknown }) {
  return {
    select: () => ({
      maybeSingle: () => Promise.resolve(result),
    }),
  };
}

const validValues = {
  title: "AI Enabled Systems design",
  summary: "",
  description: "",
  track: "advanced_training" as const,
  hero_image_url: "",
  skills: [],
  outcomes: "",
  why_take: "",
  audiences: "",
  prerequisites: [],
  curriculum: "",
  reading_assignments: "",
  class_expectations: "",
};

beforeEach(() => {
  insertChain.insertMock.mockReset();
});

describe("ClassService.create retry behavior", () => {
  it("retries on transient PGRST002 then succeeds", async () => {
    insertChain.insertMock
      .mockReturnValueOnce(buildChain({ data: null, error: { message: "schema cache miss", code: "PGRST002" } }))
      .mockReturnValueOnce(buildChain({ data: { id: "new-id" }, error: null }));

    const id = await ClassService.create("owner-1", validValues);
    expect(id).toBe("new-id");
    expect(insertChain.insertMock).toHaveBeenCalledTimes(2);
  }, 10_000);

  it("does NOT retry on RLS (42501)", async () => {
    insertChain.insertMock.mockReturnValue(
      buildChain({ data: null, error: { message: "new row violates row-level security policy", code: "42501" } })
    );

    await expect(ClassService.create("owner-1", validValues)).rejects.toMatchObject({ code: "42501" });
    expect(insertChain.insertMock).toHaveBeenCalledTimes(1);
  });

  it("throws explicit message when insert returns no row (silent RLS hide)", async () => {
    insertChain.insertMock.mockReturnValue(buildChain({ data: null, error: null }));
    await expect(ClassService.create("owner-1", validValues)).rejects.toThrow(/not created/i);
  });

  it("gives up after 3 transient attempts", async () => {
    insertChain.insertMock.mockReturnValue(
      buildChain({ data: null, error: { message: "upstream request timeout" } })
    );
    await expect(ClassService.create("owner-1", validValues)).rejects.toMatchObject({
      message: "upstream request timeout",
    });
    expect(insertChain.insertMock).toHaveBeenCalledTimes(3);
  }, 15_000);
});
