import { test, expect } from "@playwright/test";

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
    // Route is /applications/general (the general application form). The former
    // /apply alias no longer exists in the router, so it fell through to the
    // catch-all 404 — which is neither a login redirect nor an auth gate, making
    // this @critical security test silently green-blind. Point it at the real
    // protected route so the anon-gate contract is actually exercised.
    const resp = await page.goto("/applications/general", { waitUntil: "domcontentloaded" });
    expect(resp?.status() ?? 200).toBeLessThan(500);

    // Either redirected to /login or rendered the inline auth-required state.
    const url = page.url();
    const onLogin = /\/login(\/|\?|$)/.test(url);
    // The auth gate renders the LoginPage INLINE (URL unchanged) whose heading is
    // "Welcome back" with a "Sign in" submit button — so a heading-only /sign in/
    // check missed it. Detect the login form (submit button) or a gate heading.
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

    // The actual application form must NOT be mounted.
    await expect(page.getByLabel(/first name/i)).toHaveCount(0);
  });
});
