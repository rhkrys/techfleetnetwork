import { test, expect } from "../playwright-fixture";

/**
 * BDD ADMIN-EDGE-ANON-001 — Every admin route redirects an anonymous
 * visitor to /login (or renders an inline auth gate). No admin chrome,
 * grids, or RPC calls leak to unauthenticated requests. Keeps RLS honest
 * at the route boundary.
 */
const ADMIN_ROUTES = [
  "/admin",
  "/admin/recruiting-center",
  "/admin/application-analysis",
  "/admin/announcements",
  "/admin/system-health",
  "/admin/ingest",
  "/admin/classes",
  "/admin/promotions",
];

test.describe("Admin routes — anon gate (ADMIN-EDGE-ANON-001) @critical @admin", () => {
  test.describe.configure({ retries: 1, mode: "parallel" });

  for (const path of ADMIN_ROUTES) {
    test(`anonymous ${path} is gated`, async ({ page }) => {
      await page.goto(path, { waitUntil: "domcontentloaded" }).catch(() => null);
      const url = page.url();
      const onLogin = /\/login(\/|\?|$)/.test(url);
      const inlineGate = await page
        .getByRole("heading", { name: /sign in|log in|not authorized|forbidden/i })
        .first()
        .isVisible()
        .catch(() => false);
      expect(onLogin || inlineGate).toBe(true);

      // No AG Grid admin tables should have rendered.
      await expect(page.locator(".ag-root-wrapper")).toHaveCount(0);
    });
  }
});
