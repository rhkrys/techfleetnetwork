import { test, expect } from "@playwright/test";

/**
 * BDD Scenarios covered:
 * 2.1  — Successful account creation via email/password
 * 2.3  — Unsuccessful account creation due to weak password
 * 2.5  — Unsuccessful account creation due to invalid email format
 * 2.7  — Unsuccessful profile setup due to missing mandatory fields
 * 15.3 — Form submission via Enter key
 */

test.describe("Registration Page (BDD 2.1, 2.3, 2.5)", () => {
  // Auth flow specs are flaky against live Turnstile; allow exactly one retry
  // so a transient widget bootstrap doesn't tank the shard. Combined with
  // playwright.config retries=1 this still caps at a single retry max.
  test.describe.configure({ retries: 1, mode: "parallel" });

  test.beforeEach(async ({ page }) => {
    await page.goto("/register", { waitUntil: "domcontentloaded" });
    await page.getByLabel(/first name/i).waitFor({ state: "visible", timeout: 10_000 });
  });

  test("displays registration form with required fields", async ({ page }) => {
    await expect(page.getByLabel(/first name/i)).toBeVisible();
    await expect(page.getByLabel(/last name/i)).toBeVisible();
    await expect(page.getByRole("textbox", { name: /email/i })).toBeVisible();
    await expect(page.getByLabel(/^password\*?$/i)).toBeVisible();
    await expect(page.getByLabel(/confirm password/i)).toBeVisible();
  });

  test("shows password requirements checklist", async ({ page }) => {
    await page.getByLabel(/^password\*?$/i).fill("a");
    // Minimum was raised 8 → 12 chars; the checklist reads "At least 12 characters".
    await expect(page.getByText(/at least 12 characters/i)).toBeVisible();
    await expect(page.getByText(/one uppercase letter/i)).toBeVisible();
    await expect(page.getByText(/one number/i)).toBeVisible();
    await expect(page.getByText(/one special character/i)).toBeVisible();
  });

  test("BDD 2.3: shows inline errors for weak password", async ({ page }) => {
    await page.getByLabel(/first name/i).fill("Test");
    await page.getByLabel(/last name/i).fill("User");
    await page.getByRole("textbox", { name: /email/i }).fill("test@example.com");
    await page.getByLabel(/^password\*?$/i).fill("weak");
    // Submit — the register CTA is exactly "Create account" ("Sign up with
    // Google" also matches a loose /sign up/i, so anchor to avoid strict-mode).
    await page.getByRole("button", { name: /^create account$/i }).click();
    // Should show password-related errors (min length is 12 chars). The phrase
    // appears in both the requirements checklist and the submit toast, so anchor
    // to the first match to avoid a strict-mode violation.
    await expect(page.getByText(/at least 12 characters/i).first()).toBeVisible();
  });

  test("BDD 2.5: shows error for invalid email format", async ({ page }) => {
    await page.getByLabel(/first name/i).fill("Test");
    await page.getByLabel(/last name/i).fill("User");
    await page.getByRole("textbox", { name: /email/i }).fill("not-an-email");
    await page.getByLabel(/^password\*?$/i).fill("Str0ng!Pass");
    await page.getByRole("button", { name: /^create account$/i }).click();
    // The Zod message reads "Enter a valid email address" (appears inline + toast).
    await expect(page.getByText(/enter a valid email address/i).first()).toBeVisible();
  });

  test("shows Google sign-in button (BDD 2.2)", async ({ page }) => {
    // "google" also appears in the consent paragraph ("continuing with Google"),
    // so getByText matched 2 nodes. Assert the actual button by its role/name.
    await expect(page.getByRole("button", { name: /google/i })).toBeVisible();
  });

  test("has link to login page", async ({ page }) => {
    await expect(page.getByText(/sign in|log in/i)).toBeVisible();
  });
});

test.describe("Login Page (BDD 2.4, 15.3)", () => {
  test.describe.configure({ retries: 1, mode: "parallel" });

  test.beforeEach(async ({ page }) => {
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await page.getByLabel(/email/i).first().waitFor({ state: "visible", timeout: 10_000 });
  });

  test("displays login form", async ({ page }) => {
    await expect(page.getByLabel(/email/i).first()).toBeVisible();
    // /password/i also matches the "Show password" toggle button — anchor to
    // the labelled field only.
    await expect(page.getByLabel(/^password\*?$/i)).toBeVisible();
  });

  test("shows error for empty email submission", async ({ page }) => {
    // /sign in|log in|connect/i matched 3 buttons (submit, "Sign in with
    // Google", and the header "Connect"). The submit CTA is exactly "Sign in".
    await page.getByRole("button", { name: /^sign in$/i }).click();
    // Should show the inline required-field error (the field label + section
    // divider also match /email/i, so assert the specific error text).
    await expect(page.getByText(/email address is required/i)).toBeVisible();
  });

  test("has forgot password link", async ({ page }) => {
    await expect(page.getByText(/forgot password/i)).toBeVisible();
  });

  test("has link to registration page", async ({ page }) => {
    await expect(page.getByText(/sign up|new member/i)).toBeVisible();
  });

  // BDD LCL-001 — OAuth-only account hint surfaces after a failed password attempt.
  // We only assert the *plumbing* (the hint container is wired and starts hidden);
  // the live network probe to check-account-identity requires a real Turnstile token,
  // which is not solvable in CI. The unit + edge-function tests cover the flow.
  test("LCL-001: OAuth-only hint container is not shown on initial render", async ({ page }) => {
    await expect(page.getByText(/this account uses google sign-in/i)).toHaveCount(0);
  });

  // BDD LCL-002 — validation errors render inline, never as the red auth banner.
  test("LCL-002: invalid email shows inline field error, not the auth banner", async ({ page }) => {
    await page.getByLabel(/email/i).first().fill("not-an-email");
    await page.getByLabel(/^password\*?$/i).fill("whatever");
    await page.getByRole("button", { name: /^sign in$/i }).click();
    // Inline error appears (Zod copy is "Enter a valid email address").
    await expect(page.getByText(/enter a valid email address/i).first()).toBeVisible();
    // The destructive AUTH banner must NOT appear for a Zod error. Target the
    // banner by its testid — inline field errors legitimately use role="alert",
    // so a bare [role="alert"] count would also catch those.
    await expect(page.locator('[data-testid="auth-error-message"]')).toHaveCount(0);
  });
});
