import { test, expect, type BrowserContext } from "@playwright/test";
import { SCANNABLE_ROUTES, type RouteSpec } from "./a11y/routes";
import {
  collectRuntimeIssues,
  expectFocusableControlsAreVisible,
  expectKeyboardFocusVisible,
  expectNoHorizontalOverflow,
  expectNoRuntimeIssues,
} from "./helpers/runtime-stability";

/**
 * BDD Scenarios covered:
 * CROSS-BROWSER-REGRESSION-1 — Full route smoke coverage runs across supported desktop, mobile, and tablet browsers.
 * RESPONSIVE-ROUTE-STABILITY-1 — Each route avoids horizontal overflow and clipped focusable controls at tested widths.
 * FRONTEND-RUNTIME-STABILITY-1 — Browser tests fail on uncaught runtime errors, chunk-load failures, and failed critical assets.
 */

const adminEmail = process.env.TF_ADMIN_EMAIL || "";
const adminPassword = process.env.TF_ADMIN_PASSWORD || "";
const haveAdminCreds = Boolean(adminEmail && adminPassword);

let authedLocalStorage: Record<string, string> | null = null;
let authBootstrapError: string | null = null;

async function bootstrapAuth(browserContextFactory: () => Promise<BrowserContext>) {
  if (!haveAdminCreds) {
    authBootstrapError = "TF_ADMIN_EMAIL / TF_ADMIN_PASSWORD not provided.";
    return;
  }

  let context: BrowserContext | null = null;
  try {
    context = await browserContextFactory();
    const page = await context.newPage();
    await page.goto("/login");
    await page.waitForLoadState("networkidle").catch(() => {});

    await page.evaluate(() => {
      const key = "tfn.device_id.v1";
      if (!window.localStorage.getItem(key)) {
        window.localStorage.setItem(key, "playwright-cross-browser-audit-device");
      }
    });

    await page.getByLabel(/email/i).fill(adminEmail);
    await page.locator('input[id="password"], input[autocomplete="current-password"], input[type="password"]').first().fill(adminPassword);
    await page.locator('form button[type="submit"]').filter({ hasText: /sign in|log in/i }).first().click();

    await page.waitForFunction(
      () =>
        Object.keys(window.localStorage).some((key) => {
          if (!/auth-token/i.test(key)) return false;
          const value = window.localStorage.getItem(key) ?? "";
          return value.includes("access_token") || value.includes("refresh_token");
        }),
      undefined,
      { timeout: 30_000 },
    );

    authedLocalStorage = await page.evaluate(() => {
      const out: Record<string, string> = {};
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i);
        if (key) out[key] = window.localStorage.getItem(key) ?? "";
      }
      return out;
    });
  } catch (error) {
    authBootstrapError = error instanceof Error ? error.message : String(error);
    console.warn(`Authenticated browser audit disabled: ${authBootstrapError}`);
  } finally {
    await context?.close().catch(() => {});
  }
}

async function seedAuthForRoute(page: import("@playwright/test").Page, route: RouteSpec) {
  if (route.kind === "public") return;
  if (!authedLocalStorage) test.skip(true, authBootstrapError || "Authenticated storage unavailable.");

  await page.addInitScript((snapshot) => {
    for (const [key, value] of Object.entries(snapshot as Record<string, string>)) {
      window.localStorage.setItem(key, value);
    }
  }, authedLocalStorage);
}

test.describe("Cross-browser responsive route stability", () => {
  test.beforeAll(async ({ browser }) => {
    await bootstrapAuth(() => browser.newContext());
  });

  for (const route of SCANNABLE_ROUTES) {
    test(`route remains stable: ${route.label} (${route.path})`, async ({ page }) => {
      await seedAuthForRoute(page, route);
      const issues = collectRuntimeIssues(page);

      try {
        await page.goto(route.path, { waitUntil: "domcontentloaded" });
        await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
        await expect(page.locator("body")).toBeVisible();
        await expectNoHorizontalOverflow(page);
        await expectFocusableControlsAreVisible(page);
        await expectKeyboardFocusVisible(page);
        await expectNoRuntimeIssues(issues, `${route.label} (${route.path})`);
      } finally {
        issues.dispose();
      }
    });
  }
});
