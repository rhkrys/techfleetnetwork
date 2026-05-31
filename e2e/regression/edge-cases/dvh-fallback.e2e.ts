import { test, expect } from "../../playwright-fixture";

/**
 * BDD CSS-COMPAT-EDGE-DVH-001 — The app's full-viewport surfaces must
 * resolve to a real pixel height on every engine, even when `100dvh` is
 * unsupported (we ship a `@supports` fallback to `100vh`).
 *
 * Tri-layer:
 *  [UI]   The landing/login surface measures > 200px tall in a normal viewport.
 *  [DB]   N/A.
 *  [Code] No element collapses to 0 height because of a dvh-only style.
 */
test.describe("dvh fallback (CSS-COMPAT-EDGE-DVH-001) @critical", () => {
  test.describe.configure({ retries: 1, mode: "parallel" });

  test("full-viewport surfaces have real height", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const heights = await page.evaluate(() => {
      const out: number[] = [];
      const candidates = document.querySelectorAll<HTMLElement>(
        "main, [data-app-shell], #root > div"
      );
      candidates.forEach((el) => out.push(el.getBoundingClientRect().height));
      return out;
    });

    // At least one shell-level element renders with meaningful height.
    expect(heights.some((h) => h > 200)).toBe(true);
  });
});
