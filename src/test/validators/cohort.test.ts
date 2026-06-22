import { describe, it, expect } from "vitest";
import { cohortFormSchema } from "@/lib/validators/cohort";

const BASE = {
  label: "Spring 2026",
  start_date: "2026-03-01",
  end_date: "2026-04-30",
  registration_url: "https://example.com/register",
  meeting_url: "",
  timezone: "America/New_York",
  capacity: null,
};

describe("cohortFormSchema — schedule field", () => {
  it("defaults schedule to empty string when omitted", () => {
    const parsed = cohortFormSchema.parse(BASE);
    expect(parsed.schedule).toBe("");
  });

  it("accepts arbitrary safe HTML in schedule", () => {
    const parsed = cohortFormSchema.parse({ ...BASE, schedule: "<p>Mondays 6pm</p><ul><li>Week 1</li></ul>" });
    expect(parsed.schedule).toContain("Mondays 6pm");
    expect(parsed.schedule).toContain("Week 1");
  });

  it("sanitizes script tags out of schedule at the validator boundary", () => {
    const parsed = cohortFormSchema.parse({ ...BASE, schedule: "<p>ok</p><script>alert(1)</script>" });
    expect(parsed.schedule).not.toMatch(/<script/i);
    expect(parsed.schedule).toContain("ok");
  });

  it("rejects schedule above the 50,000 character ceiling", () => {
    const big = "x".repeat(50_001);
    const out = cohortFormSchema.safeParse({ ...BASE, schedule: big });
    expect(out.success).toBe(false);
  });

  it("still rejects end_date before start_date (existing behavior preserved)", () => {
    const out = cohortFormSchema.safeParse({ ...BASE, start_date: "2026-04-30", end_date: "2026-03-01" });
    expect(out.success).toBe(false);
  });
});
