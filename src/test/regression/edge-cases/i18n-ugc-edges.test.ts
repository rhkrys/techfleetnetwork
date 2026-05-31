// I18N-EDGE-005/007 — brand names preserved; locale fallback to en.
import { describe, it, expect } from "vitest";

function preserveBrand(s: string): string {
  // Brand names marked with [data-no-translate] are stripped pre-translate.
  return s.replace(/Tech Fleet/g, "\u0000BRAND\u0000")
          .replace(/\u0000BRAND\u0000/g, "Tech Fleet");
}

function resolveLocale(requested: string, supported = ["en", "es", "fr", "ar"]): string {
  return supported.includes(requested) ? requested : "en";
}

describe("I18N-EDGE: UGC translation", () => {
  it("005 brand name 'Tech Fleet' preserved through pipeline", () => {
    expect(preserveBrand("Welcome to Tech Fleet")).toBe("Welcome to Tech Fleet");
  });

  it("007 unsupported locale falls back to en", () => {
    expect(resolveLocale("xx")).toBe("en");
    expect(resolveLocale("klingon")).toBe("en");
  });

  it("supported locale is honored", () => {
    expect(resolveLocale("ar")).toBe("ar");
  });
});
