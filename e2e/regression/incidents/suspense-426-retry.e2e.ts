/**
 * Regression lock-in: Minified React error #426 (Suspense hydration race on
 * chunk swap). The ErrorBoundary auto-retries; the user must never see a
 * red error toast for #426.
 */
import { test, expect } from "@playwright/test";

test("incident: React #426 is swallowed by ErrorBoundary retry", async ({ page }) => {
  const seen: string[] = [];
  page.on("pageerror", (e) => seen.push(e.message));
  await page.goto("/");
  await page.waitForTimeout(1500);
  const visible426 = await page
    .locator('[role="alert"], [data-sonner-toast]')
    .filter({ hasText: /error #426|hydration/i })
    .count();
  expect(visible426).toBe(0);
});
