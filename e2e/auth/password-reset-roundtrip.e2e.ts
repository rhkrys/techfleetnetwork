import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
const anonKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const appBaseUrl = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? 4173}`;
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
        options: { redirectTo: `${appBaseUrl}/reset-password` },
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
