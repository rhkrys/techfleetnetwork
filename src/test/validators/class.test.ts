import { describe, it, expect } from "vitest";
import { classFormSchema } from "@/lib/validators/class";

const BASE = {
  title: "AI Enabled Systems design",
  track: "advanced_training" as const,
};

describe("classFormSchema — new optional rich-text fields", () => {
  it("defaults curriculum, reading_assignments, class_expectations to empty string", () => {
    const parsed = classFormSchema.parse(BASE);
    expect(parsed.curriculum).toBe("");
    expect(parsed.reading_assignments).toBe("");
    expect(parsed.class_expectations).toBe("");
  });

  it("accepts safe HTML in all three new fields", () => {
    const parsed = classFormSchema.parse({
      ...BASE,
      curriculum: "<h3>Module 1</h3><p>Intro</p>",
      reading_assignments: "<ul><li>Paper A</li></ul>",
      class_expectations: "<p>Show up. Be kind.</p>",
    });
    expect(parsed.curriculum).toContain("Module 1");
    expect(parsed.reading_assignments).toContain("Paper A");
    expect(parsed.class_expectations).toContain("Be kind");
  });

  it("strips script tags from new fields at the validator boundary", () => {
    const parsed = classFormSchema.parse({
      ...BASE,
      curriculum: "<p>ok</p><script>alert(1)</script>",
      reading_assignments: "<script>evil()</script><p>read</p>",
      class_expectations: "<p>fine</p><script>x()</script>",
    });
    expect(parsed.curriculum).not.toMatch(/<script/i);
    expect(parsed.reading_assignments).not.toMatch(/<script/i);
    expect(parsed.class_expectations).not.toMatch(/<script/i);
  });

  it("rejects curriculum above the 50,000 character ceiling", () => {
    const out = classFormSchema.safeParse({ ...BASE, curriculum: "x".repeat(50_001) });
    expect(out.success).toBe(false);
  });

  it("rejects reading_assignments above the 20,000 character ceiling", () => {
    const out = classFormSchema.safeParse({ ...BASE, reading_assignments: "x".repeat(20_001) });
    expect(out.success).toBe(false);
  });

  it("rejects class_expectations above the 20,000 character ceiling", () => {
    const out = classFormSchema.safeParse({ ...BASE, class_expectations: "x".repeat(20_001) });
    expect(out.success).toBe(false);
  });

  it("still requires title (existing behavior preserved)", () => {
    const out = classFormSchema.safeParse({ track: "basic_training" });
    expect(out.success).toBe(false);
  });
});
