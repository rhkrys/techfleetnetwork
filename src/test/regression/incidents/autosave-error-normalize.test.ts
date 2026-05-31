// Regression: use-autosave rejected non-Error → "[object Object]" leaked into logs.
// Lock in: any thrown non-Error gets coerced via toError() to a real Error with a string message.
import { describe, it, expect } from "vitest";
import { toError } from "@/lib/errors/toError";

describe("incident: autosave error normalization", () => {
  it("coerces plain objects to Error with serialized message", () => {
    const e = toError({ code: "FAIL", detail: "x" });
    expect(e).toBeInstanceOf(Error);
    expect(e.message).not.toBe("[object Object]");
    expect(e.message.length).toBeGreaterThan(0);
  });

  it("coerces strings to Error", () => {
    const e = toError("boom");
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toBe("boom");
  });

  it("preserves Error message when wrapping", () => {
    const orig = new Error("original");
    expect(toError(orig).message).toBe("original");
    expect(toError(orig)).toBeInstanceOf(Error);
  });

  it("never returns the literal '[object Object]'", () => {
    for (const v of [{}, [], 0, null, undefined, NaN, { a: 1 }]) {
      expect(toError(v).message).not.toBe("[object Object]");
    }
  });
});
