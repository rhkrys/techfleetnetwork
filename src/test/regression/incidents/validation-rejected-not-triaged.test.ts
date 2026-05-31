// Regression: Zod validation_rejected events must stay in audit_log, never reach agent_fix_queue.
import { describe, it, expect } from "vitest";
import { classifyError } from "@/lib/observability/classify";

describe("incident: validation_rejected is audit-only", () => {
  it("classifier drops validation_rejected", () => {
    expect(classifyError({ message: "validation_rejected", source: "edge-fn" }).action).toBe("drop");
  });

  it("classifier drops Zod-style errors with field path", () => {
    expect(
      classifyError({
        message: "validation_rejected: body.email — Invalid email",
        source: "edge-fn",
      }).action,
    ).toBe("drop");
  });
});
