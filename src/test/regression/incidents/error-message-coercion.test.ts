/**
 * Regression lock-in: "Error: [object Object]" from use-autosave + similar
 * `unhandledrejection` paths. Anything that surfaces an error to the user or
 * the reporter must coerce non-Error values into Error(message:string).
 */
import { describe, it, expect } from "vitest";

function toError(value: unknown): Error {
  if (value instanceof Error) return value;
  if (typeof value === "string") return new Error(value);
  try {
    const json = JSON.stringify(value);
    return new Error(json && json !== "{}" ? json : String(value));
  } catch {
    return new Error(String(value));
  }
}

describe("incident: error-message-coercion (use-autosave [object Object])", () => {
  it("coerces a plain object into an Error with a JSON message", () => {
    const err = toError({ code: "PGRST116", details: null });
    expect(err).toBeInstanceOf(Error);
    expect(err.message).not.toBe("[object Object]");
    expect(err.message).toContain("PGRST116");
  });

  it("coerces null/undefined/string/number without throwing or returning [object Object]", () => {
    for (const v of [null, undefined, "boom", 42, NaN, true]) {
      const e = toError(v);
      expect(e).toBeInstanceOf(Error);
      expect(e.message).not.toBe("[object Object]");
      expect(e.message.length).toBeGreaterThan(0);
    }
  });

  it("handles circular references without crashing", () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    expect(() => toError(a)).not.toThrow();
  });
});
