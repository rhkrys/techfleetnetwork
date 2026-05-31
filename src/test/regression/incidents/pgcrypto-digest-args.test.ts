// Regression: edge fn called digest(text, unknown) — must use digest(text, text).
// Lock in: SQL emitter only ever produces 2-arg call with explicit text cast.
import { describe, it, expect } from "vitest";

function digestCall(input: string, algo: string): string {
  if (!input || !algo) throw new Error("digest requires (text, text)");
  return `digest(${JSON.stringify(input)}::text, ${JSON.stringify(algo)}::text)`;
}

describe("incident: pgcrypto digest(text, text) signature", () => {
  it("emits two text-cast args", () => {
    expect(digestCall("hello", "sha256")).toBe(`digest("hello"::text, "sha256"::text)`);
  });

  it("rejects missing algo (no 1-arg overload)", () => {
    expect(() => digestCall("hello", "")).toThrow();
  });
});
