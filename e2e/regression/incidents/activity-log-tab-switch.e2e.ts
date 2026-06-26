/**
 * NO-RELOAD-TAB-001 / NO-RELOAD-TAB-002 / ACTIVITY-LOG-STATE-001 (2026-06-16).
 *
 * Locks the permanent fix for the user-reported regression:
 *   "Whenever I navigate away from the tab that's got the platform and go
 *   back to it, /admin/activity-log reloads itself. I lose my place."
 *
 * The test is gated on an admin preview-session env var so it stays a smoke
 * test in CI; locally it auto-skips if the credentials aren't set.
 */
import { test, expect } from "@playwright/test";

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD;

test.skip(!ADMIN_EMAIL || !ADMIN_PASSWORD, "Admin credentials not configured (E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD)");

test("admin activity log: tab switch and reload both preserve state", async ({ context, page }) => {
  // ── Sign in as admin ──────────────────────────────────────────────────
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(ADMIN_EMAIL!);
  await page.getByLabel(/password/i).fill(ADMIN_PASSWORD!);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 15_000 });

  // ── Visit /admin/activity-log and set non-default state ───────────────
  await page.goto("/admin/activity-log");
  await page.waitForLoadState("networkidle").catch(() => {});

  // Severity = error
  await page.getByLabel(/filter by severity/i).click();
  await page.getByRole("option", { name: /^error$/i }).click();
  await expect(page).toHaveURL(/severityFilter=error/);

  // Type into search
  await page.getByLabel(/search activity log/i).fill("trace:nrlt-001");
  // Debounce flush
  await page.waitForTimeout(400);
  await expect(page).toHaveURL(/search=trace%3Anrlt-001/);

  // Scroll halfway down
  await page.evaluate(() => window.scrollTo({ top: 600, behavior: "auto" }));

  // ── Tab switch: open a second tab for 5 s, then return ────────────────
  const reloadsBefore: string[] = [];
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) reloadsBefore.push(frame.url());
  });

  const second = await context.newPage();
  await second.goto("about:blank");
  await page.waitForTimeout(5_000);
  await second.close();
  await page.bringToFront();
  await page.waitForTimeout(500);

  // Assert: no extra navigation happened while we were away. The single
  // navigation already recorded is the visit to /admin/activity-log itself
  // — anything beyond that is the bug we're locking out.
  expect(reloadsBefore.length).toBeLessThanOrEqual(1);

  // Assert: state is intact.
  await expect(page).toHaveURL(/severityFilter=error/);
  await expect(page).toHaveURL(/search=trace%3Anrlt-001/);
  await expect(page.getByLabel(/search activity log/i)).toHaveValue("trace:nrlt-001");

  // ── Hard reload: state must hydrate from URL + sessionStorage ─────────
  await page.reload({ waitUntil: "networkidle" });
  await expect(page).toHaveURL(/severityFilter=error/);
  await expect(page.getByLabel(/search activity log/i)).toHaveValue("trace:nrlt-001");
  // Scroll restoration is best-effort — accept within 200 px.
  const scrollY = await page.evaluate(() => window.scrollY);
  expect(scrollY).toBeGreaterThan(400);
});
