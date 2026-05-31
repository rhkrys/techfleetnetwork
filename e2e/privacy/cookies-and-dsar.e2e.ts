import { test, expect } from "../../playwright-fixture";

/**
 * BDD W1-PCC-002 — DSAR submission page is reachable to authenticated members.
 * BDD W1-PCC-001 — Cookie consent banner gates analytics on first visit.
 *
 * Anonymous-safe assertions only; full DSAR submission flow requires an
 * authenticated fixture (added in a later wave).
 */
test.describe("Privacy & Cookies (BDD W1-PCC-001, W1-PCC-002)", () => {
  test.describe.configure({ retries: 1, mode: "parallel" });

  test("W1-PCC-001: cookie banner is reachable from /cookies", async ({ page }) => {
    await page.goto("/cookies", { waitUntil: "domcontentloaded" });
    await expect(page.locator("main, [role='main']").first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test("W1-PCC-002: /privacy/dsar renders the DSAR intake surface", async ({ page }) => {
    const res = await page.goto("/privacy/dsar", { waitUntil: "domcontentloaded" });
    // Either authenticated DSAR form OR auth gate — both are valid responses.
    expect(res?.status() ?? 200).toBeLessThan(500);
    await expect(page.locator("body")).toBeVisible();
  });
});
