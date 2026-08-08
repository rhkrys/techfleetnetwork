import { test, expect } from "@playwright/test";

/**
 * BDD OBS-EDGE-ANON-001 — Anonymous hitting the observer opt-in lesson is
 * redirected to login; no observer_role_grants row is created.
 *
 * Tri-layer:
 *  [UI]   /community/observer or /learn/obs-8 redirects to /login
 *  [DB]   no observer_role_grants insert occurs (covered by RLS sweep)
 *  [Code] grant-observer-role edge fn rejects requests without JWT (covered
 *         by src/test/regression/edge-cases/anon-write-deny-sweep.test.ts)
 */
test.describe("Observer opt-in — anon gate (OBS-EDGE-ANON-001) @critical", () => {
  test.describe.configure({ retries: 1, mode: "parallel" });

  // Real protected route is /courses/observer (ObserverCoursePage, wrapped in
  // <ProtectedRoute>). The former /community/observer and /learn/obs-8 aliases
  // no longer exist — they hit the catch-all 404, which is neither a login
  // redirect nor an auth gate, so this @critical anon-gate test was green-blind.
  for (const path of ["/courses/observer"]) {
    test(`anonymous ${path} visit is gated`, async ({ page }) => {
      await page.goto(path, { waitUntil: "domcontentloaded" }).catch(() => null);
      // Either redirected or inline-gated; both are acceptable.
      const url = page.url();
      const onLogin = /\/login(\/|\?|$)/.test(url);
      // Gate renders the LoginPage inline ("Welcome back" heading + "Sign in"
      // submit button), URL unchanged — detect the form, not just a heading.
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
    });
  }
});
