import { test, expect } from "../playwright-fixture";

/**
 * BDD W1-EWV-001 — Events page renders without surfacing stale events.
 *
 * Anonymous smoke: confirms the /events route loads. The HARD_FLOOR_MS
 * stale-event guard is exercised at the worker + RPC layer (covered by
 * dedicated unit tests).
 */
test.describe("Events week view (BDD W1-EWV-001)", () => {
  test.describe.configure({ retries: 1, mode: "parallel" });

  test("loads /events without 5xx", async ({ page }) => {
    const res = await page.goto("/events", { waitUntil: "domcontentloaded" });
    expect(res?.status() ?? 200).toBeLessThan(500);
    await expect(page.locator("body")).toBeVisible();
  });
});
