import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
const anonKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const canRunLiveRoundtrip = Boolean(url && anonKey && serviceKey);

test.describe("AUTH-RESET-011 password reset round trip", () => {
  test.skip(!canRunLiveRoundtrip, "Live auth round trip requires backend URL, anon key, and service-role CI secret.");

  test("reset link sets a confirmed password that works in a fresh sign-in", async ({ page }) => {
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const email = `auth-reset-${Date.now()}@example.com`;
    const oldPassword = "OldStrongPass123!";
    const newPassword = "NewStrongPass123!";

    const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password: oldPassword, email_confirm: true });
    expect(createError).toBeNull();

    try {
      const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
        type: "recovery",
        email,
        options: { redirectTo: `${test.info().project.use.baseURL}/reset-password` },
      });
      expect(linkError).toBeNull();
      expect(linkData.properties?.action_link).toBeTruthy();

      await page.goto(linkData.properties!.action_link!);
      await expect(page.getByRole("heading", { name: /set your new password/i })).toBeVisible();
      await page.getByLabel(/^new password$/i).fill(newPassword);
      await page.getByLabel(/confirm new password/i).fill(newPassword);
      await page.getByRole("button", { name: /update password/i }).click();
      await expect(page.getByText(/use your new password the next time you sign in/i)).toBeVisible();

      const fresh = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
      const oldAttempt = await fresh.auth.signInWithPassword({ email, password: oldPassword });
      expect(oldAttempt.error?.message).toMatch(/invalid/i);

      const newAttempt = await fresh.auth.signInWithPassword({ email, password: newPassword });
      expect(newAttempt.error).toBeNull();
      expect(newAttempt.data.user?.email).toBe(email);
    } finally {
      if (created.user?.id) await admin.auth.admin.deleteUser(created.user.id).catch(() => undefined);
    }
  });
});

test.describe("AUTH-RESET-010 reset confirmation UI", () => {
  test("mismatched confirmation cannot submit", async ({ page }) => {
    await page.goto("/reset-password?type=recovery");
    await page.evaluate(() => {
      window.localStorage.setItem("sb-test-auth-token", JSON.stringify({ access_token: "header.payload.signature", refresh_token: "header.payload.signature" }));
    });
    await page.route("**/auth/v1/token**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ access_token: "header.payload.signature", refresh_token: "header.payload.signature", user: { id: "e2e-user" } }) }));
    await page.route("**/auth/v1/user**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: "e2e-user", email: "e2e@example.com" }) }));

    await page.goto("/reset-password?type=recovery&code=test-code");
    await page.getByLabel(/^new password$/i).fill("StrongPass123!");
    await page.getByLabel(/confirm new password/i).fill("StrongPass124!");
    await expect(page.getByRole("button", { name: /update password/i })).toBeDisabled();
    await expect(page.getByText(/passwords do not match/i)).toBeVisible();
  });
});