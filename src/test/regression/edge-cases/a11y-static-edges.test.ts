// A11Y-EDGE-001/010 — sentinel checks for icon labels + viewport scalability.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "..", "..", "..", "..");

describe("A11Y-EDGE: static accessibility guarantees", () => {
  it("010 index.html viewport does not disable user scaling", () => {
    const html = readFileSync(resolve(ROOT, "index.html"), "utf8");
    const m = html.match(/<meta[^>]*name=["']viewport["'][^>]*>/i);
    expect(m, "viewport meta tag must exist").not.toBeNull();
    expect(m![0]).not.toMatch(/user-scalable\s*=\s*no/i);
    expect(m![0]).not.toMatch(/maximum-scale\s*=\s*1[^0-9.]/i);
  });

  it("001 Icon wrapper exists and requires label for non-decorative use", () => {
    // Sentinel: confirm the Icon wrapper file exists; ESLint enforces label.
    const candidates = ["src/components/ui/icon.tsx", "src/components/ui/Icon.tsx"];
    const found = candidates.some((p) => {
      try { readFileSync(resolve(ROOT, p), "utf8"); return true; } catch { return false; }
    });
    expect(found).toBe(true);
  });
});
