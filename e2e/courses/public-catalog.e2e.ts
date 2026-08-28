import { test, expect } from "@playwright/test";

/**
 * Epic 03 — the public course catalog must render for a signed-OUT visitor.
 *
 * These assertions are deliberately about REACHABILITY and the absence of an
 * auth wall, not about specific course content (which depends on seeded data).
 * The 404-heading guard is what stops this from passing on the router fallback
 * the way the old project-openings spec did.
 */
test.describe("Public course catalog (Epic 03)", () => {
  test.describe.configure({ retries: 1, mode: "parallel" });

  test("anonymous visitor can load /classes without an auth redirect", async ({ page }) => {
    await page.goto("/classes", { waitUntil: "domcontentloaded" });

    await expect(page.locator("main, [role='main']").first()).toBeVisible({ timeout: 10_000 });

    // Still on /classes — never bounced to sign-in.
    await expect(page).toHaveURL(/\/classes(\/|\?|$)/);

    // Not the router's 404 fallback.
    await expect(page.getByRole("heading", { name: "404" })).toHaveCount(0);

    // The catalog heading rendered.
    await expect(page.getByRole("heading", { name: /^Courses$/i })).toBeVisible();
  });

  test("the Courses link is visible to anonymous visitors and reaches the catalog", async ({
    page,
  }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const coursesLink = page.getByRole("link", { name: /^Courses$/i }).first();
    await expect(coursesLink).toBeVisible({ timeout: 10_000 });
    await coursesLink.click();
    await expect(page).toHaveURL(/\/classes/);
  });

  test("an unknown course slug shows a not-found state, not an auth wall", async ({ page }) => {
    await page.goto("/classes/this-course-does-not-exist", { waitUntil: "domcontentloaded" });
    await expect(page.locator("main, [role='main']").first()).toBeVisible({ timeout: 10_000 });
    await expect(page).not.toHaveURL(/\/login/);
  });
});
