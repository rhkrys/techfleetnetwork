import { test, expect } from "@playwright/test";

/**
 * BDD ADMIN-EDGE-ANON-001 — Every admin route redirects an anonymous
 * visitor to /login (or renders an inline auth gate). No admin chrome,
 * grids, or RPC calls leak to unauthenticated requests. Keeps RLS honest
 * at the route boundary.
 */
// Real AdminRoute-guarded paths from src/App.tsx. The prior list mixed in
// routes that no longer exist (/admin, /admin/recruiting-center,
// /admin/application-analysis, /admin/announcements, /admin/promotions) — those
// fell through to the catch-all 404, which is neither a login redirect nor an
// auth gate, so this @critical test was silently green-blind on them. Every
// path below is a live <AdminRoute> route, so an anon visit must redirect/gate.
const ADMIN_ROUTES = [
  "/admin/users",
  "/admin/ingest",
  "/admin/system-health",
  "/admin/classes",
  "/admin/roster",
  "/admin/activity-log",
  "/admin/clients",
  "/admin/banners",
];

test.describe("Admin routes — anon gate (ADMIN-EDGE-ANON-001) @critical @admin", () => {
  test.describe.configure({ retries: 1, mode: "parallel" });

  for (const path of ADMIN_ROUTES) {
    test(`anonymous ${path} is gated`, async ({ page }) => {
      await page.goto(path, { waitUntil: "domcontentloaded" }).catch(() => null);
      const url = page.url();
      const onLogin = /\/login(\/|\?|$)/.test(url);
      // The gate renders the LoginPage inline ("Welcome back" heading + "Sign in"
      // submit button) with the URL unchanged, so a heading-only /sign in/ check
      // missed it (every admin route failed, including ones that DO exist).
      // Detect the login form (submit button) or an access-denied heading.
      const inlineGate =
        (await page
          .getByRole("button", { name: /^sign in$/i })
          .first()
          .isVisible()
          .catch(() => false)) ||
        (await page
          .getByRole("heading", { name: /welcome back|sign in|log in|not authorized|forbidden/i })
          .first()
          .isVisible()
          .catch(() => false));
      expect(onLogin || inlineGate).toBe(true);

      // No AG Grid admin tables should have rendered.
      await expect(page.locator(".ag-root-wrapper")).toHaveCount(0);
    });
  }
});
