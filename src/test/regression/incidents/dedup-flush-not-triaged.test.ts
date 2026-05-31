// Regression: aggregate dedup flush ("duplicate client error(s) deduped") must NOT enter triage.
import { describe, it, expect } from "vitest";
import { isSuppressed } from "@/services/error-reporter.service";

describe("incident: dedup-flush events are not triaged", () => {
  it("drops the dedup summary signal", () => {
    expect(isSuppressed("duplicate client error(s) deduped: 17 fingerprints over 60s")).toBe(true);
  });
  it("drops ResizeObserver loop noise (browser quirk)", () => {
    expect(isSuppressed("ResizeObserver loop completed with undelivered notifications.")).toBe(true);
  });
});
