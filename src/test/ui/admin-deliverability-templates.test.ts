import { describe, it, expect, vi } from "vitest";

// PR 9: the triage-digest template was removed; the deliverability smoke harness must no longer
// list it (otherwise an admin test run would try a template that no longer exists).
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: vi.fn() } },
}));

import { TEMPLATES } from "@/pages/AdminEmailDeliverabilityTestPage";

describe("AdminEmailDeliverabilityTestPage template list", () => {
  it("no longer includes the removed triage-digest template", () => {
    expect(TEMPLATES.some((t) => t.name === "triage-digest")).toBe(false);
  });

  it("still covers representative transactional templates", () => {
    expect(TEMPLATES.some((t) => t.name === "interview-invite")).toBe(true);
    expect(TEMPLATES.length).toBeGreaterThan(5);
  });
});
