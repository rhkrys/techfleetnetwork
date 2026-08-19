import { test, expect } from "@playwright/test";
import { isIgnorableRuntimeNoise } from "../../helpers/runtime-stability";

/**
 * BDD PERF-EDGE-VITALS-001 — When the /record-web-vital edge fn is down,
 * the page must not throw, retry forever, or block paint. The beacon is a
 * fire-and-forget contract.
 *
 * Tri-layer:
 *  [UI]   Landing route paints normally even when vitals endpoint 503s.
 *  [DB]   N/A (insert fails by design here — we assert it does not cascade).
 *  [Code] No `pageerror` from the failed beacon; no infinite retry loop.
 */
test.describe("Web vitals beacon failure (PERF-EDGE-VITALS-001) @critical", () => {
  test.describe.configure({ retries: 1, mode: "parallel" });

  test("503 from record-web-vital does not crash the page", async ({ page }) => {
    let beaconHits = 0;
    await page.route("**/functions/v1/record-web-vital*", async (route) => {
      beaconHits += 1;
      await route.fulfill({ status: 503, body: "Service Unavailable" });
    });

    const fatal: string[] = [];
    // Ignore third-party noise (e.g. CookieYes' preview-URL notice) via the
    // shared runtime-stability allowlist — this collector predates that helper.
    page.on("pageerror", (err) => {
      const m = String(err?.message ?? err);
      if (!isIgnorableRuntimeNoise(m)) fatal.push(m);
    });

    const resp = await page.goto("/", { waitUntil: "domcontentloaded" });
    expect(resp?.status() ?? 200).toBeLessThan(500);

    // Give the web-vitals reporter a chance to fire on LCP/FCP.
    await page.waitForTimeout(2000);

    // App stays alive even with beacon failing.
    await expect(page.locator("body")).toBeVisible();
    expect(fatal, fatal.join("\n")).toEqual([]);

    // And we are NOT retrying forever (sanity: bounded count).
    expect(beaconHits).toBeLessThan(25);
  });
});
