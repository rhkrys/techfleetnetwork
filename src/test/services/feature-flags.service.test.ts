// bdd-gate coverage: src/services/feature-flags.service.ts
import { describe, it, expect } from "vitest";
import { hashBucket, isEnabledIn, type FeatureFlag } from "@/services/feature-flags.service";

function snap(flag: { key: string } & Partial<FeatureFlag>): Map<string, FeatureFlag> {
  const f: FeatureFlag = { enabled: false, rollout_percent: 0, ...flag };
  return new Map([[f.key, f]]);
}

const KEY = "logger_error_reporting";

describe("hashBucket", () => {
  it("is deterministic and in [0,100)", () => {
    for (const s of ["a", "logger_error_reporting|u1", "x|y|z"]) {
      const b = hashBucket(s);
      expect(b).toBe(hashBucket(s));
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(100);
    }
  });

  // Golden vector — MUST equal the edge copy (supabase/functions/_shared/feature-flags.test.ts).
  // If either side's hashBucket changes, cohorts drift between client and edge; this catches it.
  it("matches the cross-runtime golden vector", () => {
    expect(hashBucket("logger_error_reporting|u1")).toBe(29);
  });
});

describe("isEnabledIn", () => {
  it("is off when the flag is absent or the snapshot is empty", () => {
    expect(isEnabledIn(new Map(), KEY, "u1")).toBe(false);
    expect(isEnabledIn(null, KEY, "u1")).toBe(false);
  });

  it("is off when disabled, even at 100% rollout (kill-switch wins)", () => {
    expect(isEnabledIn(snap({ key: KEY, enabled: false, rollout_percent: 100 }), KEY, "u1")).toBe(
      false
    );
  });

  it("is on for everyone at 100%", () => {
    const s = snap({ key: KEY, enabled: true, rollout_percent: 100 });
    for (const u of ["u1", "u2", "u3"]) expect(isEnabledIn(s, KEY, u)).toBe(true);
  });

  it("is off for everyone at 0%", () => {
    const s = snap({ key: KEY, enabled: true, rollout_percent: 0 });
    for (const u of ["u1", "u2", "u3"]) expect(isEnabledIn(s, KEY, u)).toBe(false);
  });

  it("is sticky per member across repeated checks", () => {
    const s = snap({ key: KEY, enabled: true, rollout_percent: 50 });
    const first = isEnabledIn(s, KEY, "user-42");
    for (let i = 0; i < 5; i++) expect(isEnabledIn(s, KEY, "user-42")).toBe(first);
  });

  it("respects the dial threshold exactly (bucket < percent)", () => {
    const uid = "user-42";
    const b = hashBucket(`${KEY}|${uid}`);
    expect(isEnabledIn(snap({ key: KEY, enabled: true, rollout_percent: b + 1 }), KEY, uid)).toBe(
      true
    );
    expect(isEnabledIn(snap({ key: KEY, enabled: true, rollout_percent: b }), KEY, uid)).toBe(
      false
    );
  });

  it("enables roughly the dialed fraction of members", () => {
    const s = snap({ key: KEY, enabled: true, rollout_percent: 50 });
    let on = 0;
    const N = 2000;
    for (let i = 0; i < N; i++) if (isEnabledIn(s, KEY, `u${i}`)) on++;
    expect(on / N).toBeGreaterThan(0.4);
    expect(on / N).toBeLessThan(0.6);
  });
});
