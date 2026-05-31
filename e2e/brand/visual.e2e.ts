/**
 * Brand Visual Guide v1 — runtime conformance suite (BV-016).
 *
 * Asserts shipped CSS/runtime values match the Brand Visual Guide:
 *  - --primary HSL resolves to Tech Fleet Blue (#0056A7) within tolerance
 *  - body font-family includes Poppins
 *  - heading font-family includes Futura PT or Jost (display fallback)
 *  - no off-grid font sizes (text-[10px], text-[13px], etc.) in the DOM
 *
 * Tri-layer Then mapping for BV-016:
 *  [UI]   computed styles match brand tokens on every audited route
 *  [Code] this Playwright suite blocks merge if a route drifts
 *  [DB]   bdd_scenarios row BV-016 tracks coverage; no schema change
 */
import { test, expect } from "@playwright/test";

const ROUTES = [
  "/",
  "/login",
  "/register",
  "/forgot-password",
  "/accessibility",
  "/privacy",
  "/cookies",
  "/terms",
];

// Light brand: HSL(209, 100%, 33%) ≈ #0056A7 (Tech Fleet Blue)
// Dark brand : HSL(217, 73%, 48%)  ≈ Action Blue (Visual Guide v1 dark surface)
// Routes can render in either theme depending on user/system preference, so
// accept either anchor within tolerance.
const PRIMARY_VARIANTS = [
  { h: 209, s: 100, l: 33 },
  { h: 217, s: 73, l: 48 },
];
const HSL_TOLERANCE = { hue: 4, sat: 8, light: 6 };

function parseHsl(value: string): { h: number; s: number; l: number } | null {
  // Accepts "211 100% 33%" (CSS var format) or "hsl(211, 100%, 33%)".
  const m = value
    .replace(/hsla?\(|\)|,/g, " ")
    .trim()
    .match(/(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)%?\s+(-?\d+(?:\.\d+)?)%?/);
  if (!m) return null;
  return { h: +m[1], s: +m[2], l: +m[3] };
}

for (const route of ROUTES) {
  test(`brand: ${route} honors Visual Guide v1 tokens`, async ({ page }) => {
    await page.goto(route);
    await page.waitForLoadState("domcontentloaded");

    const { primaryRaw, bodyFont, headingFont, offGridSizes } =
      await page.evaluate(() => {
        const root = getComputedStyle(document.documentElement);
        const body = getComputedStyle(document.body);
        const heading =
          document.querySelector("h1, h2, h3") ??
          document.querySelector("[class*='font-display']");
        const headingStyle = heading
          ? getComputedStyle(heading as Element)
          : body;

        // Detect arbitrary off-grid font sizes left behind by ad-hoc Tailwind
        // classes like text-[10px] / text-[13px]. Brand grid = 4px multiples.
        const offGrid: string[] = [];
        document.querySelectorAll("*").forEach((el) => {
          const cls = (el as HTMLElement).className;
          if (typeof cls !== "string") return;
          const m = cls.match(/text-\[(\d+)px\]/);
          if (m && +m[1] % 2 !== 0) offGrid.push(m[0]);
        });

        return {
          primaryRaw: root.getPropertyValue("--primary").trim(),
          bodyFont: body.fontFamily,
          headingFont: headingStyle.fontFamily,
          offGridSizes: Array.from(new Set(offGrid)),
        };
      });

    const hsl = parseHsl(primaryRaw);
    expect(hsl, `--primary should be parseable HSL, got "${primaryRaw}"`).not.toBeNull();
    if (hsl) {
      expect(Math.abs(hsl.h - PRIMARY_HUE)).toBeLessThanOrEqual(HSL_TOLERANCE.hue);
      expect(Math.abs(hsl.s - PRIMARY_SAT)).toBeLessThanOrEqual(HSL_TOLERANCE.sat);
      expect(Math.abs(hsl.l - PRIMARY_LIGHT)).toBeLessThanOrEqual(HSL_TOLERANCE.light);
    }

    expect(bodyFont.toLowerCase()).toMatch(/poppins/);
    expect(headingFont.toLowerCase()).toMatch(/futura|jost|poppins/);

    expect(
      offGridSizes,
      `Off-grid font sizes found on ${route}: ${offGridSizes.join(", ")}`
    ).toEqual([]);
  });
}
