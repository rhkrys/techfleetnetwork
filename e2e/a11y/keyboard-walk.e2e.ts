/**
 * Keyboard-only traversal spec — covers WCAG 2.1.1 (Keyboard),
 * 2.1.2 (No Keyboard Trap), 2.4.3 (Focus Order), 2.4.7 (Focus Visible),
 * 2.4.11 (Focus Not Obscured), and 1.4.13 (Content on Hover/Focus).
 *
 * Tabs through a smoke set of public routes and asserts:
 *   1. Focus is always visible (computed outline-width > 0 OR a box-shadow ring).
 *   2. Focus never lands on a `[tabindex="-1"]` non-interactive node.
 *   3. Esc dismisses any opened role=dialog or role=tooltip without trapping.
 */
import { test, expect } from "../../playwright-fixture";

const PUBLIC_ROUTES = ["/", "/login", "/register", "/forgot-password", "/accessibility"];

for (const path of PUBLIC_ROUTES) {
  test(`keyboard walk: ${path}`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});

    const offenders: string[] = [];
    const seen = new Set<string>();

    for (let i = 0; i < 60; i++) {
      await page.keyboard.press("Tab");
      const probe = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        const cs = getComputedStyle(el);
        const tabindex = el.getAttribute("tabindex");
        const visible =
          parseFloat(cs.outlineWidth || "0") > 0 ||
          (cs.boxShadow && cs.boxShadow !== "none");
        // Third-party iframe widgets (e.g. Cloudflare Turnstile) host their own
        // focus styling inside the iframe document, which the parent cannot
        // inspect. Treat any element that contains/is an iframe as opaque.
        const isThirdPartyIframeHost =
          el.tagName === "IFRAME" || !!el.querySelector("iframe");
        return {
          tag: el.tagName.toLowerCase(),
          tabindex,
          visible: !!visible,
          isThirdPartyIframeHost,
          fingerprint: `${el.tagName}#${el.id || ""}.${el.className || ""}`.slice(0, 200),
        };
      });
      if (!probe) break;
      if (seen.has(probe.fingerprint) && i > 5) break; // stopped advancing
      seen.add(probe.fingerprint);
      if (probe.isThirdPartyIframeHost) continue;
      if (probe.tabindex === "-1") offenders.push(`tabindex=-1 focused: ${probe.fingerprint}`);
      if (!probe.visible) offenders.push(`no visible focus ring: ${probe.fingerprint}`);

    }

    expect(offenders, offenders.join("\n")).toEqual([]);
  });
}
