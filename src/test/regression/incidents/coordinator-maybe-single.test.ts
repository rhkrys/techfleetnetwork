// Regression: coordinator-for-app surfaced PGRST116 when zero rows; switched to maybeSingle().
// Lock in: helper that wraps single-row reads returns null instead of throwing on no-rows.
import { describe, it, expect } from "vitest";

function pickMaybeSingle<T>(rows: T[]): T | null {
  if (rows.length === 0) return null;
  if (rows.length > 1) throw new Error("PGRST116: multiple rows for maybeSingle");
  return rows[0];
}

describe("incident: coordinator-for-app maybeSingle()", () => {
  it("returns null for zero rows (no PGRST116 to client)", () => {
    expect(pickMaybeSingle([])).toBeNull();
  });

  it("returns the row for exactly one", () => {
    expect(pickMaybeSingle([{ id: "1" }])).toEqual({ id: "1" });
  });

  it("still throws on multiple — keeps invariant", () => {
    expect(() => pickMaybeSingle([{ id: "1" }, { id: "2" }])).toThrow(/PGRST116/);
  });
});
