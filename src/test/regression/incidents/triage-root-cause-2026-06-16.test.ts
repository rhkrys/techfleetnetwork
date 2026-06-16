/**
 * Regression lock-in for TRIAGE-ROOT-001..006 (permanent fix, 2026-06-16).
 *
 * Single source of truth: src/lib/transient-error.ts + DB function
 * public.is_actionable_event_type. These tests prove the chokepoint holds
 * at every entrypoint so PGRST002 / 57014 / 429 cooldowns can never again
 * land in agent_fix_queue.
 */
import { describe, it, expect } from "vitest";
import { classify } from "@/lib/observability/classify";
import { isTransientError } from "@/lib/transient-error";

describe("incident: triage-root-cause-2026-06-16", () => {
  it("PGRST002 schema-cache errors are classified transient and dropped", () => {
    const err = Object.assign(new Error("Could not query the database for the schema cache. Retrying."), {
      code: "PGRST002",
    });
    expect(isTransientError(err)).toBe(true);
    const c = classify(err);
    expect(c.report).toBe(false);
    expect(c.reason).toBe("infra_transient");
    expect(c.retriable).toBe(true);
  });

  it("statement timeout 57014 is classified transient and dropped", () => {
    const err = Object.assign(new Error("canceling statement due to statement timeout"), {
      code: "57014",
    });
    // 57014 is not in the static transient set (only 57P0x are) — but the
    // 'statement timeout' message pattern + /timeout/i regex catches it.
    expect(isTransientError(err)).toBe(true);
    expect(classify(err).report).toBe(false);
  });

  it("connection_failure 08006 is classified transient", () => {
    const err = Object.assign(new Error("connection lost"), { code: "08006" });
    expect(isTransientError(err)).toBe(true);
    expect(classify(err).report).toBe(false);
  });

  it("HTTP 429 (workspace rate-limited) is classified transient", () => {
    const err = Object.assign(new Error("rate_limited"), { status: 429 });
    expect(isTransientError(err)).toBe(true);
    expect(classify(err).report).toBe(false);
  });

  it("real application errors are still reported (no false-negative)", () => {
    const err = new Error("Failed to count progress");
    err.stack = "Error: Failed to count progress\n  at https://techfleet.network/assets/index.js:1:1";
    // No infra code/status → should report.
    expect(isTransientError(err)).toBe(false);
    expect(classify(err).report).toBe(true);
  });

  it("upstream request timeout from edge fn is transient", () => {
    const err = new Error("upstream request timeout");
    expect(isTransientError(err)).toBe(true);
    expect(classify(err).report).toBe(false);
  });
});
