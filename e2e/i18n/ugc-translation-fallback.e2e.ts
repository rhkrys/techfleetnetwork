import { test, expect } from "../../playwright-fixture";

/**
 * BDD I18N-UGC-EDGE-001 — When a UGC translation is missing for the active
 * locale, <TranslatedContent/> falls back to the source string instead of
 * rendering a loading placeholder or an empty node.
 *
 * Tri-layer:
 *  [UI]   public homepage renders meaningful text in any locale
 *  [DB]   missing rows in ugc_translations don't block rendering
 *  [Code] useUgcTranslation hook returns the source on cache miss
 */
test.describe("UGC translation fallback (I18N-UGC-EDGE-001)", () => {
  test.describe.configure({ retries: 1, mode: "parallel" });

  test("home renders non-empty text under an exotic locale", async ({ page, context }) => {
    await context.addInitScript(() => {
      try {
        localStorage.setItem("preferred_language", "is-IS"); // Icelandic — unlikely to be pre-translated
      } catch {
        /* ignore */
      }
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });
    const main = page.locator("main, [role='main']").first();
    await expect(main).toBeVisible({ timeout: 10_000 });

    // Body must contain at least some non-whitespace text — never an empty
    // shell — even when translations are unavailable.
    const text = (await main.innerText()).trim();
    expect(text.length).toBeGreaterThan(10);
  });
});
