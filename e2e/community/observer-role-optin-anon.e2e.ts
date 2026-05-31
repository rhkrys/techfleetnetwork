import { test, expect } from "../../../playwright-fixture";

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

  for (const path of ["/community/observer", "/learn/obs-8"]) {
    test(`anonymous ${path} visit is gated`, async ({ page }) => {
      await page.goto(path, { waitUntil: "domcontentloaded" }).catch(() => null);
      // Either redirected or inline-gated; both are acceptable.
      const url = page.url();
      const onLogin = /\/login(\/|\?|$)/.test(url);
      const inlineGate = await page
        .getByRole("heading", { name: /sign in|log in/i })
        .first()
        .isVisible()
        .catch(() => false);
      expect(onLogin || inlineGate).toBe(true);
    });
  }
});
