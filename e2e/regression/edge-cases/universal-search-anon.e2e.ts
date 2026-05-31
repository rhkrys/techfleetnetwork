import { test, expect } from "@playwright/test";

/**
 * BDD US-EDGE-ANON-001 — Anonymous users cannot open ⌘K universal search.
 *
 * Tri-layer:
 *  [UI]   keyboard shortcut on a public page does not mount the search dialog
 *  [DB]   no privileged queries fire (search RPCs require auth)
 *  [Code] CommandPalette mount is gated by useAuth().user
 */
test.describe("Universal search — anon gate (US-EDGE-ANON-001)", () => {
  test.describe.configure({ retries: 1, mode: "parallel" });

  test("⌘K on a public page does not open the search palette", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.keyboard.press("Meta+K").catch(() => null);
    await page.keyboard.press("Control+K").catch(() => null);
    // Palette dialog should not appear for anonymous visitors.
    const palette = page.getByRole("dialog", { name: /search|command/i });
    await expect(palette).toHaveCount(0);
  });
});
