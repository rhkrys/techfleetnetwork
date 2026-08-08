import { describe, it, expect } from "vitest";
import { computeRelease, availabilityLabel } from "./release";

// Fixed clock so every assertion is deterministic (2026-09-05T12:00:00Z).
const NOW = new Date("2026-09-05T12:00:00Z");

describe("computeRelease", () => {
  it("all_at_once is always released", () => {
    expect(computeRelease({ policy: "all_at_once", now: NOW }).released).toBe(true);
  });

  describe("by_date", () => {
    it("is locked before the date, with availableAt set", () => {
      const r = computeRelease({ policy: "by_date", releaseAt: "2026-09-10T00:00:00Z", now: NOW });
      expect(r.released).toBe(false);
      expect(r.availableAt?.toISOString()).toBe("2026-09-10T00:00:00.000Z");
    });
    it("is released at/after the date", () => {
      expect(
        computeRelease({ policy: "by_date", releaseAt: "2026-09-01T00:00:00Z", now: NOW }).released
      ).toBe(true);
    });
    it("is released exactly at the boundary", () => {
      expect(
        computeRelease({ policy: "by_date", releaseAt: NOW.toISOString(), now: NOW }).released
      ).toBe(true);
    });
    it("is locked when no date is configured (guards a broken state)", () => {
      expect(computeRelease({ policy: "by_date", now: NOW }).released).toBe(false);
    });
  });

  describe("relative_to_cohort_start (F10 — the learner's own cohort)", () => {
    it("uses each learner's own cohort start + offset", () => {
      const l1 = computeRelease({
        policy: "relative_to_cohort_start",
        offsetDays: 7,
        cohortStart: "2026-09-01",
        now: NOW,
      });
      const l2 = computeRelease({
        policy: "relative_to_cohort_start",
        offsetDays: 7,
        cohortStart: "2026-10-01",
        now: NOW,
      });
      expect(l1.availableAt?.toISOString().slice(0, 10)).toBe("2026-09-08");
      expect(l2.availableAt?.toISOString().slice(0, 10)).toBe("2026-10-08");
      expect(l1.released).toBe(false); // NOW = 09-05, before 09-08
      expect(l2.released).toBe(false);
    });
    it("is released once the offset has elapsed", () => {
      expect(
        computeRelease({
          policy: "relative_to_cohort_start",
          offsetDays: 2,
          cohortStart: "2026-09-01",
          now: NOW,
        }).released
      ).toBe(true); // available 09-03 <= 09-05
    });
    it("is locked when the learner has no cohort", () => {
      expect(
        computeRelease({
          policy: "relative_to_cohort_start",
          offsetDays: 7,
          cohortStart: null,
          now: NOW,
        }).released
      ).toBe(false);
    });
    it("offset 0 releases on the cohort start day", () => {
      expect(
        computeRelease({
          policy: "relative_to_cohort_start",
          offsetDays: 0,
          cohortStart: "2026-09-05",
          now: NOW,
        }).released
      ).toBe(true);
    });
  });

  describe("after_previous_completion", () => {
    it("the first required item is always released", () => {
      expect(
        computeRelease({ policy: "after_previous_completion", isFirst: true, now: NOW }).released
      ).toBe(true);
    });
    it("is locked until the previous item is complete, then released", () => {
      expect(
        computeRelease({ policy: "after_previous_completion", previousCompleted: false, now: NOW })
          .released
      ).toBe(false);
      expect(
        computeRelease({ policy: "after_previous_completion", previousCompleted: true, now: NOW })
          .released
      ).toBe(true);
    });
  });

  // Property-style invariant: all_at_once ⇒ every item released regardless of
  // the other inputs (comprehensive-test-strategy: property/invariant testing).
  it("all_at_once releases regardless of other inputs", () => {
    for (const previousCompleted of [true, false]) {
      for (const cohortStart of [null, "2099-01-01"]) {
        expect(
          computeRelease({
            policy: "all_at_once",
            previousCompleted,
            cohortStart,
            offsetDays: 9999,
            now: NOW,
          }).released
        ).toBe(true);
      }
    }
  });
});

describe("availabilityLabel", () => {
  it("prompts to finish the previous lesson under drip", () => {
    expect(
      availabilityLabel({ released: false, availableAt: null }, "after_previous_completion")
    ).toMatch(/previous lesson/i);
  });
  it("shows a date for by_date locks", () => {
    const r = computeRelease({ policy: "by_date", releaseAt: "2026-12-01T00:00:00Z", now: NOW });
    expect(availabilityLabel(r, "by_date")).toMatch(/Available on/);
  });
  it("returns 'Available' when released", () => {
    expect(availabilityLabel({ released: true, availableAt: NOW }, "all_at_once")).toBe(
      "Available"
    );
  });
});
