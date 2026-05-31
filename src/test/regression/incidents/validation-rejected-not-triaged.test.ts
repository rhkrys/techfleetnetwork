// Regression: Zod validation_rejected events must stay in audit_log, never reach agent_fix_queue.
import { describe, it, expect } from "vitest";
import { isSuppressed } from "@/services/error-reporter.service";

describe("incident: validation_rejected is audit-only", () => {
  it("classifier drops validation_rejected", () => {
    expect(isSuppressed("validation_rejected")).toBe(true);
  });
  it("classifier drops Zod-style errors with field path", () => {
    expect(isSuppressed("validation_rejected: body.email — Invalid email")).toBe(true);
  });
});
