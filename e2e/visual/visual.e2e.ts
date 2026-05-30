/**
 * Visual regression suite — Track 1.
 *
 * Pixel-diff snapshot tests on a curated set of public routes across two
 * viewports (desktop 1280×720, mobile 390×844). Runs only under the
 * `visual-regression*` projects defined in playwright.config.ts (gated by
 * `PLAYWRIGHT_VISUAL=1`) so it never runs in the fast PR gate.
 *
 * Stability tactics:
 *   1. Disable all transitions / animations / caret rendering.
 *   2. Wait for `document.fonts.ready` and the `[data-rum-ready]` sentinel
 *      set by `src/lib/web-vitals.ts` so deferred work has settled.
 *   3. `toHaveScreenshot({ maxDiffPixelRatio: 0.01 })` — tolerates < 1%
 *      drift from font hinting / sub-pixel AA jitter.
 *
 * Update workflow: maintainers add the `visual-baseline-update` label on the
 * PR; CI re-runs with `--update-snapshots` and commits the new PNGs.
 *
 * BDD:  VISREG-001..004
 */
import { test, expect } from "@playwright/test";

const ROUTES = [
  { path: "/", name: "landing" },
  { path: "/login", name: "login" },
  { path: "/register", name: "register" },
  { path: "/forgot-password", name: "forgot-password" },
  { path: "/project-openings", name: "project-openings" },
  { path: "/accessibility", name: "accessibility" },
  { path: "/privacy", name: "privacy" },
  { path: "/cookies", name: "cookies" },
  { path: "/terms", name: "terms" },
  { path: "/404-does-not-exist", name: "not-found" },
];

async function stabilize(page) {
  // Kill animations/transitions/caret blink — eliminates the dominant source
  // of visual flake without changing production behaviour.
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation: none !important;
        transition: none !important;
        caret-color: transparent !important;
      }
    `,
  });
  // Wait for fonts + RUM idle sentinel.
  await page.evaluate(async () => {
    try { await document.fonts.ready; } catch { /* noop */ }
  });
  await page
    .waitForSelector("body[data-rum-ready='true']", { timeout: 5000 })
    .catch(() => {
      // RUM beacon is opt-in / save-data may skip it; don't fail the test.
    });
  // Settle a final RAF — gives layout shifts a chance to finish.
  await page.evaluate(
    () => new Promise<void>((res) => requestAnimationFrame(() => requestAnimationFrame(() => res()))),
  );
}

test.describe("visual regression", () => {
  // Only run under the dedicated visual-regression projects (PLAYWRIGHT_VISUAL=1).
  // The default matrix projects (chromium-desktop, etc.) don't ship baseline
  // PNGs for these routes, so skip to keep the fast PR gate green.
  test.skip(
    ({}, testInfo) => !testInfo.project.name.startsWith("visual-"),
    "Visual regression runs only under visual-* projects (PLAYWRIGHT_VISUAL=1).",
  );
  test.beforeEach(async ({ page }) => {
    // Freeze Date and Math.random so any timestamp/animation in the DOM is stable.
    await page.addInitScript(() => {
      const FIXED = 1737936000000; // 2025-01-27T00:00:00Z
      const OrigDate = Date;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).Date = class extends OrigDate {
        constructor(...args: unknown[]) {
          if (args.length === 0) super(FIXED);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          else super(...(args as any));
        }
        static now() { return FIXED; }
      };
      Math.random = () => 0.4242;
    });
  });

  for (const { path, name } of ROUTES) {
    test(`route ${name} matches snapshot`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState("domcontentloaded");
      await stabilize(page);
      await expect(page).toHaveScreenshot(`${name}.png`, {
        fullPage: true,
        maxDiffPixelRatio: 0.01,
        animations: "disabled",
        caret: "hide",
      });
    });
  }
});
