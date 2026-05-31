/**
 * Security headers smoke test — OWASP A02:2025 (Security Misconfiguration).
 *
 * Asserts the PUBLISHED production host returns the baseline browser-side
 * defense headers. Runs in regression CI so a CDN/host config drift is caught
 * within one PR cycle.
 *
 * Required headers (per A02 + MDN OWASP Secure Headers Project):
 *   - Strict-Transport-Security
 *   - X-Content-Type-Options: nosniff
 *   - Referrer-Policy
 *   - Permissions-Policy
 *   - Content-Security-Policy  (report-only acceptable)
 *
 * BDD: ARCH-SEC-HDR-001
 */
import { describe, it, expect } from "vitest";

const HOST =
  process.env.SECURITY_HEADERS_HOST?.replace(/\/+$/, "") ??
  "https://techfleet.network";

const REQUIRED = [
  "strict-transport-security",
  "x-content-type-options",
  "referrer-policy",
  "permissions-policy",
];

const CSP_VARIANTS = ["content-security-policy", "content-security-policy-report-only"];

// Skip when offline / CI without network. We mark via env so local runs
// don't fail without an outbound route.
const RUN = process.env.RUN_SECURITY_HEADERS_SMOKE === "1";

describe.skipIf(!RUN)("security headers smoke (OWASP A02)", () => {
  it(`returns required browser security headers from ${HOST}`, async () => {
    const res = await fetch(HOST, { method: "GET", redirect: "follow" });
    expect(res.ok, `Expected 2xx from ${HOST}, got ${res.status}`).toBe(true);

    const headers = Object.fromEntries(
      [...res.headers.entries()].map(([k, v]) => [k.toLowerCase(), v])
    );

    for (const h of REQUIRED) {
      expect(headers[h], `Missing required header: ${h}`).toBeTruthy();
    }

    const hasCsp = CSP_VARIANTS.some((h) => headers[h]);
    expect(
      hasCsp,
      "Missing Content-Security-Policy (or Content-Security-Policy-Report-Only)"
    ).toBe(true);

    // HSTS must include a meaningful max-age (>= 6 months recommended; we
    // accept any positive max-age and let the host config evolve).
    const hsts = headers["strict-transport-security"];
    expect(hsts).toMatch(/max-age=\d+/i);

    // nosniff is the only valid value for X-Content-Type-Options.
    expect(headers["x-content-type-options"]?.toLowerCase()).toBe("nosniff");
  }, 30_000);
});
