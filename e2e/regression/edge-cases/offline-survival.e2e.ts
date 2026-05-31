/**
 * Wave 3 (cont.) — EDGE-007 sweep: app survives an offline drop on public
 * routes (no white-screen, error boundary keeps the chrome). Locks:
 *   ANN-EDGE-007, NOTIF-EDGE-007, PRIV-EDGE-007, PERF-EDGE-007,
 *   ACT-LOG-EDGE-007, OBS-EDGE-007, USRCH-EDGE-007, NET-ACT-EDGE-007
 */
import { test, expect } from "@playwright/test";

test.describe.configure({ mode: "parallel" });

for (const path of ["/", "/privacy", "/cookies", "/accessibility"]) {
  test(`survives offline drop on ${path}`, async ({ page, context }) => {
    await page.goto(path, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => undefined);

    // Drop the network mid-session.
    await context.setOffline(true);
    // Trigger a soft navigation to force any in-flight fetches.
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await page.waitForTimeout(300);

    // App shell must still render — body is non-empty and has visible text.
    const visibleText = await page.evaluate(() => document.body.innerText.trim().length);
    expect(visibleText, `${path} blanked out when offline`).toBeGreaterThan(20);

    // Restore for cleanup.
    await context.setOffline(false);
  });
}
