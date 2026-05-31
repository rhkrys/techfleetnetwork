import { test, expect } from "../../playwright-fixture";

/**
 * BDD W1-POD-001 — Anonymous can view a public project opening.
 *
 * This spec is intentionally lightweight: it asserts the public-projects
 * listing route renders for an anonymous visitor without redirecting to
 * /login. Deeper assertions (specific role cards, apply CTA) live in the
 * authenticated admin/member specs.
 */
test.describe("Public project openings (BDD W1-POD-001)", () => {
  test.describe.configure({ retries: 1, mode: "parallel" });

  test("anonymous visitor can load /projects without redirect", async ({ page }) => {
    await page.goto("/projects", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/projects(\/|\?|$)/);
    // Page chrome should render — landmark presence is enough at this layer.
    await expect(page.locator("main, [role='main']").first()).toBeVisible({
      timeout: 10_000,
    });
  });
});
