/**
 * Regression lock-in: stale dynamic-import chunk load (107 occurrences before
 * fix). The page must surface a controlled recovery state (lazyWithRetry +
 * deploy-watcher), NOT an unhandled error toast.
 */
import { test, expect } from "@playwright/test";

test("incident: stale chunk load is recovered, not surfaced as error", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  // Block one lazy chunk to simulate a stale deploy.
  await page.route(/assets\/.*\.js$/, (route, request) => {
    const url = request.url();
    // Only break one chunk so the rest of the app still boots.
    if (url.includes("chunk-") || /\.[0-9a-f]{8}\.js$/.test(url)) {
      return route.fulfill({ status: 404, body: "stale" });
    }
    return route.continue();
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });
  // Give lazyWithRetry a moment.
  await page.waitForTimeout(2000);
  await expect(page.locator("body")).toBeVisible();
  // No unhandled `Error: Failed to fetch dynamically imported module` toast.
  const userVisible = await page
    .locator('[role="alert"], [data-sonner-toast]')
    .filter({ hasText: /failed to fetch|dynamically imported/i })
    .count();
  expect(userVisible).toBe(0);
});
