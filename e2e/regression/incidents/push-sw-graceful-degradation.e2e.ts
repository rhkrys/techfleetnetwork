/**
 * Regression lock-in: "Push notifications are not ready because the app
 * service worker is unavailable." path. Must NOT throw to ErrorBoundary —
 * UI either hides the toggle or shows an unavailable state.
 */
import { test, expect } from "@playwright/test";

test("incident: push-sw graceful degradation does not crash boot", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.addInitScript(() => {
    // @ts-expect-error force-remove serviceWorker before app boots
    delete navigator.serviceWorker;
  });

  await page.goto("/");
  await expect(page.locator("body")).toBeVisible();
  expect(
    errors.find((m) => /service worker is unavailable/i.test(m)),
    "push-subscription path must catch missing SW, not throw",
  ).toBeUndefined();
});
