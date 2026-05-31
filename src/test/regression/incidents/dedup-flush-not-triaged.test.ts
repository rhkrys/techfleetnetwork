// Regression: aggregate dedup flush ("duplicate client error(s) deduped") must NOT enter triage.
import { describe, it, expect } from "vitest";
import { classifyError } from "@/lib/observability/classify";

describe("incident: dedup-flush events are not triaged", () => {
  it("drops the dedup summary signal", () => {
    expect(
      classifyError({
        message: "duplicate client error(s) deduped: 17 unique fingerprints over 60s",
        source: "client",
      }).action,
    ).toBe("drop");
  });

  it("drops ResizeObserver loop noise (browser quirk)", () => {
    expect(
      classifyError({
        message: "ResizeObserver loop completed with undelivered notifications.",
        source: "client",
      }).action,
    ).toBe("drop");
  });
});
