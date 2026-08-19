import { test, expect } from "@playwright/test";
import { isIgnorableRuntimeNoise } from "../../helpers/runtime-stability";

/**
 * BDD NOTIF-EDGE-PUSH-001 — When the browser has no service worker (or it is
 * disabled), the push-notification toggle must fall back to an "unavailable"
 * state instead of throwing. Locks in the graceful-degradation contract from
 * mem://tech/graceful-degradation.
 *
 * Tri-layer:
 *  [UI]   /notifications loads without uncaught errors when SW is stubbed out.
 *  [DB]   N/A (anon path — no push_subscriptions write expected).
 *  [Code] No unhandledrejection / "service worker unavailable" error toast.
 */
test.describe("Push SW graceful degradation (NOTIF-EDGE-PUSH-001) @critical", () => {
  test.describe.configure({ retries: 1, mode: "parallel" });

  test("disabled service worker does not crash anon notifications surface", async ({ page }) => {
    // Strip serviceWorker before any app code runs.
    await page.addInitScript(() => {
      try {
        Object.defineProperty(navigator, "serviceWorker", {
          configurable: true,
          get: () => undefined,
        });
      } catch {
        /* noop */
      }
    });

    const fatal: string[] = [];
    // Ignore third-party noise (e.g. CookieYes' preview-URL notice) via the
    // shared runtime-stability allowlist — this collector predates that helper.
    page.on("pageerror", (err) => {
      const m = String(err?.message ?? err);
      if (!isIgnorableRuntimeNoise(m)) fatal.push(m);
    });
    page.on("console", (msg) => {
      if (msg.type() === "error" && /service worker|push/i.test(msg.text())) {
        fatal.push(msg.text());
      }
    });

    const resp = await page.goto("/notifications", { waitUntil: "domcontentloaded" });
    // Anon will likely be redirected to /login — that's fine; the contract is
    // "no thrown error from missing SW", not "page renders".
    expect(resp?.status() ?? 200).toBeLessThan(500);

    await page.waitForTimeout(750);
    expect(fatal, fatal.join("\n")).toEqual([]);
  });
});
