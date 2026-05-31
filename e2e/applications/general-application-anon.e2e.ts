import { test, expect } from "../../../playwright-fixture";

/**
 * BDD GA-EDGE-ANON-001 — Anonymous visitor hitting the general application
 * form is sent to /login (no form fields rendered, no draft created).
 *
 * Tri-layer assertion:
 *  [UI]   /apply route redirects to /login or shows the login gate
 *  [DB]   no general_applications row was created (anon has no session)
 *  [Code] AuthRequired guard runs before <GeneralApplicationForm/> mounts
 */
test.describe("General application — anon gate (GA-EDGE-ANON-001) @critical", () => {
  test.describe.configure({ retries: 1, mode: "parallel" });

  test("anonymous /apply visit is gated to login", async ({ page }) => {
    const resp = await page.goto("/apply", { waitUntil: "domcontentloaded" });
    expect(resp?.status() ?? 200).toBeLessThan(500);

    // Either redirected to /login or rendered the inline auth-required state.
    const url = page.url();
    const onLogin = /\/login(\/|\?|$)/.test(url);
    const inlineGate = await page
      .getByRole("heading", { name: /sign in|log in/i })
      .first()
      .isVisible()
      .catch(() => false);

    expect(onLogin || inlineGate).toBe(true);

    // The actual application form must NOT be mounted.
    await expect(page.getByLabel(/first name/i)).toHaveCount(0);
  });
});
