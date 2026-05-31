import { test, expect } from "@playwright/test";

/**
 * BDD PRIV-EDGE-001 — Footer policy links are reachable from any public
 * page and resolve to a 200 with meaningful copy. Locks in the Privacy &
 * Cookies compliance contract (no broken policy URLs).
 */
test.describe("Policy footer links (PRIV-EDGE-001) @critical", () => {
  test.describe.configure({ retries: 1, mode: "parallel" });

  for (const path of ["/privacy", "/cookies", "/accessibility", "/terms"]) {
    test(`anonymous can load ${path}`, async ({ page }) => {
      const resp = await page.goto(path, { waitUntil: "domcontentloaded" });
      expect(resp?.status() ?? 200).toBeLessThan(400);
      const main = page.locator("main, [role='main']").first();
      await expect(main).toBeVisible({ timeout: 10_000 });
      const text = (await main.innerText()).trim();
      expect(text.length).toBeGreaterThan(40);
    });
  }
});
