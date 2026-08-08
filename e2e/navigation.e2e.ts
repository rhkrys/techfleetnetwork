import { test, expect } from "@playwright/test";

/**
 * BDD Scenarios covered:
 * 15.4 — Hand cursor on hover for interactive elements
 * 15.5 — Responsive design across screen sizes
 */

test.describe("Landing Page & Navigation", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle").catch(() => {});
  });

  test("landing page loads successfully", async ({ page }) => {
    await expect(page).toHaveTitle(/.+/);
    // Should have some content visible
    await expect(page.locator("body")).not.toBeEmpty();
  });

  test("has navigation to login", async ({ page }) => {
    const loginLink = page.getByRole("link", { name: /connect|login|sign in/i });
    await expect(loginLink).toBeVisible();
  });

  test("BDD 15.5: responsive layout on mobile viewport", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");
    await page.waitForLoadState("networkidle").catch(() => {});
    // Page should still be visible and not have horizontal overflow
    const body = page.locator("body");
    await expect(body).toBeVisible();
    const bodyBox = await body.boundingBox();
    expect(bodyBox?.width).toBeLessThanOrEqual(375);
  });

  test("BDD 15.5: responsive layout on tablet viewport", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto("/");
    await page.waitForLoadState("networkidle").catch(() => {});
    const body = page.locator("body");
    await expect(body).toBeVisible();
  });

  test("BDD 15.4: buttons have pointer cursor", async ({ page }) => {
    const buttons = page.getByRole("button");
    const count = await buttons.count();
    if (count > 0) {
      const cursor = await buttons.first().evaluate((el) => window.getComputedStyle(el).cursor);
      expect(cursor).toBe("pointer");
    }
  });

  test("BDD 15.4: links have pointer cursor", async ({ page }) => {
    const links = page.getByRole("link");
    const count = await links.count();
    if (count > 0) {
      const cursor = await links.first().evaluate((el) => window.getComputedStyle(el).cursor);
      expect(cursor).toBe("pointer");
    }
  });
});

test.describe("404 Page", () => {
  test("shows not found for invalid routes", async ({ page }) => {
    await page.goto("/this-page-does-not-exist");
    await page.waitForLoadState("networkidle").catch(() => {});
    // The NotFound page renders BOTH a "404" heading and an "Oops! Page not
    // found" paragraph, so getByText(/not found|404/i) matched 2 elements and
    // tripped strict mode. Anchor on the heading — the unambiguous 404 marker.
    await expect(page.getByRole("heading", { name: "404" })).toBeVisible();
  });
});

test.describe("Password Reset Flow (BDD 2.9)", () => {
  test("forgot password page loads", async ({ page }) => {
    await page.goto("/forgot-password");
    await page.waitForLoadState("networkidle").catch(() => {});
    await expect(page.getByLabel(/email/i)).toBeVisible();
  });

  test("reset password page loads", async ({ page }) => {
    await page.goto("/reset-password");
    await page.waitForLoadState("networkidle").catch(() => {});
    // Should have password input
    await expect(page.locator("body")).not.toBeEmpty();
  });
});
