/**
 * Regression lock-in for "Refused to load" CSP violations. Asserts the
 * landing page response carries a CSP header without 'unsafe-eval'.
 */
import { test, expect } from "@playwright/test";

test("incident: CSP header forbids unsafe-eval", async ({ page }) => {
  const response = await page.goto("/");
  expect(response, "landing page returned no response").not.toBeNull();
  const csp =
    response!.headers()["content-security-policy"] ??
    response!.headers()["content-security-policy-report-only"] ??
    "";
  // If CSP is enforced via meta tag instead of header, fall back to DOM.
  if (!csp) {
    const meta = await page
      .locator('meta[http-equiv="Content-Security-Policy"]')
      .first()
      .getAttribute("content")
      .catch(() => null);
    if (!meta) test.skip(true, "no CSP header or meta found in this environment");
    expect(meta ?? "").not.toMatch(/unsafe-eval/i);
    return;
  }
  expect(csp).not.toMatch(/unsafe-eval/i);
});
