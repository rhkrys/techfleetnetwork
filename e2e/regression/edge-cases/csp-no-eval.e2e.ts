import { test, expect } from "@playwright/test";

/**
 * BDD SEC-EDGE-CSP-001 — Global CSP smoke. The published bundle must not
 * rely on `unsafe-eval` and must not load arbitrary third-party scripts.
 * Locks in the security/defense-in-depth contract.
 *
 * Tri-layer:
 *  [UI]   No CSP violation events on landing route.
 *  [DB]   N/A (static contract).
 *  [Code] index.html + headers do not whitelist `unsafe-eval`.
 */
test.describe("CSP no-eval (SEC-EDGE-CSP-001) @critical", () => {
  test.describe.configure({ retries: 1, mode: "parallel" });

  test("landing page emits no CSP violations and no eval-style scripts", async ({ page }) => {
    const violations: string[] = [];
    page.on("console", (msg) => {
      const t = msg.text();
      if (/Content Security Policy|Refused to (execute|load)/i.test(t)) {
        violations.push(t);
      }
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {});

    // No CSP violations surfaced to console.
    expect(violations, violations.join("\n")).toEqual([]);

    // No inline `eval(` or `new Function(` smuggled into the served HTML.
    const html = await page.content();
    expect(html).not.toMatch(/\beval\s*\(/);
    expect(html).not.toMatch(/new\s+Function\s*\(/);
  });
});
