import { test, expect } from "@playwright/test";

/**
 * BDD Scenarios covered:
 * COURSE-VIDEO-RESIZE-CONTINUITY-1 — Resizing a lesson dialog must not replace the active video iframe.
 */

test.describe("Course video resize continuity", () => {
  test("keeps the same embedded video instance when the viewport is resized", async ({ page }) => {
    await page.goto("/courses/discord-learning");
    await page.waitForLoadState("networkidle").catch(() => {});

    if (page.url().includes("/login")) {
      test.skip(true, "Course video resize continuity requires an authenticated session.");
    }

    const watchButton = page.getByRole("button", { name: /watch/i }).first();
    if (!(await watchButton.isVisible().catch(() => false))) {
      test.skip(true, "No visible course video lesson was available in this environment.");
    }

    await watchButton.click();
    const iframe = page.locator('iframe[src*="youtube.com/embed"]').first();
    await expect(iframe).toBeVisible();

    const marker = `video-${Date.now()}`;
    await iframe.evaluate((element, value) => {
      element.setAttribute("data-playwright-video-marker", value);
    }, marker);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(250);
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.waitForTimeout(250);

    await expect(iframe).toHaveAttribute("data-playwright-video-marker", marker);
  });
});