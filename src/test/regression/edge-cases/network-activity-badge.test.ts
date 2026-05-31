// NETACT-EDGE-003/004 — aggregate badge count clamping.
import { describe, it, expect } from "vitest";

function badgeLabel(n: number, cap = 99): string {
  if (n <= 0) return "";
  return n > cap ? `${cap}+` : String(n);
}

describe("NETACT-EDGE: network activity badge", () => {
  it("003 shows raw count under cap", () => {
    expect(badgeLabel(12)).toBe("12");
  });

  it("004 clamps to 99+ when over cap", () => {
    expect(badgeLabel(150)).toBe("99+");
    expect(badgeLabel(100)).toBe("99+");
  });

  it("returns empty for zero/negative", () => {
    expect(badgeLabel(0)).toBe("");
    expect(badgeLabel(-1)).toBe("");
  });
});
