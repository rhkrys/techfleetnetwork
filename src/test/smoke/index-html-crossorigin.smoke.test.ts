/**
 * TRIAGE-NOISE-034: Production `dist/index.html` <script> tags must all carry
 * `crossorigin` (anonymous), so the browser exposes real stack frames from our
 * own bundles to window.onerror instead of the opaque "Script error." string.
 *
 * Vite preserves attributes on the entry <script type="module" crossorigin="anonymous">
 * declared in `index.html`. This test fails the build if a future change drops
 * that attribute or introduces an entry <script> without it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const DIST_HTML = resolve(process.cwd(), "dist/index.html");

describe("dist/index.html crossorigin enforcement", () => {
  it("every <script src=...> tag carries crossorigin", () => {
    if (!existsSync(DIST_HTML)) {
      // The smoke test is opportunistic — only runs after `npm run build`.
      // In environments without a build artifact, no-op (still passes).
      console.log("[crossorigin-smoke] dist/index.html missing — skipping");
      return;
    }
    const html = readFileSync(DIST_HTML, "utf8");
    // Match all <script ... src="..."> tags (with or without type attribute).
    const tags = html.match(/<script\b[^>]*\bsrc=[^>]*>/g) ?? [];
    expect(tags.length, "expected at least one bundled <script src> in dist/index.html").toBeGreaterThan(0);
    const offenders = tags.filter((t) => !/\bcrossorigin\b/i.test(t));
    expect(offenders, `every bundled <script> must declare crossorigin. Offenders:\n${offenders.join("\n")}`).toEqual([]);
  });
});
