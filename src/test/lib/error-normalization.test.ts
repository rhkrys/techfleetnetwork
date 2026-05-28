import { describe, expect, it } from "vitest";
import { formatThrowable, normalizeThrownError } from "@/lib/error-normalization";

describe("error-normalization (BDD AUTOSAVE-ERROR-001)", () => {
  it("turns backend error objects into actionable Error messages", () => {
    const err = normalizeThrownError({
      message: "permission denied for table project_applications",
      code: "42501",
      details: "RLS policy rejected the write",
      hint: "Check project_applications policies",
    });

    expect(err.message).toContain("permission denied for table project_applications");
    expect(err.message).toContain("code=42501");
    expect(err.message).toContain("details=RLS policy rejected the write");
    expect(err.message).toContain("hint=Check project_applications policies");
    expect(err.message).not.toContain("[object Object]");
    expect(err.code).toBe("42501");
  });

  it("formats opaque objects without [object Object]", () => {
    const formatted = formatThrowable({ error: { message: "Nested failure", status: 500 } });

    expect(formatted).toContain("Nested failure");
    expect(formatted).not.toContain("[object Object]");
  });
});