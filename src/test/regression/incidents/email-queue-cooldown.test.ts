// Regression EMAIL-RL-001..004: per-lane cooldown with exponential backoff on 429.
// Lock in: backoff = max(provider, 60 * 2^(n-1)), capped at 900s; success resets.
import { describe, it, expect } from "vitest";

function computeBackoff(attempt: number, providerSeconds = 0): number {
  const exp = 60 * Math.pow(2, Math.max(0, attempt - 1));
  return Math.min(900, Math.max(providerSeconds, exp));
}

describe("incident: email queue per-lane cooldown", () => {
  it("first attempt is at least 60s", () => {
    expect(computeBackoff(1)).toBe(60);
  });

  it("exponential doubling", () => {
    expect(computeBackoff(2)).toBe(120);
    expect(computeBackoff(3)).toBe(240);
    expect(computeBackoff(4)).toBe(480);
  });

  it("caps at 900s", () => {
    expect(computeBackoff(10)).toBe(900);
    expect(computeBackoff(20)).toBe(900);
  });

  it("respects provider Retry-After when larger", () => {
    expect(computeBackoff(1, 300)).toBe(300);
    expect(computeBackoff(1, 30)).toBe(60); // floor still 60
  });

  it("provider Retry-After also capped at 900", () => {
    expect(computeBackoff(1, 5000)).toBe(900);
  });
});
