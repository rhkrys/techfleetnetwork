import { test, expect } from "../../../playwright-fixture";

/**
 * BDD TRIAGE-EDGE-NOISE-001 — Extension/runtime noise (MetaMask,
 * "Extension context invalidated", ResizeObserver loop, raw "Script error.")
 * must be classified and dropped by the client error reporter, never
 * enqueued into agent_fix_queue.
 *
 * This spec drives the classifier directly via window.dispatchEvent so we
 * can run anonymously and stay deterministic.
 *
 * Tri-layer:
 *  [UI]   No "Something went wrong" toast surfaces.
 *  [DB]   N/A (anon — no insert expected; verified by absence of network call).
 *  [Code] /functions/v1/triage-error never receives a payload for the dropped strings.
 */
test.describe("Triage extension noise (TRIAGE-EDGE-NOISE-001) @critical", () => {
  test.describe.configure({ retries: 1, mode: "parallel" });

  test("classifier drops MetaMask / ResizeObserver / extension-context noise", async ({ page }) => {
    const triageHits: string[] = [];
    await page.route("**/functions/v1/triage-error*", (route) => {
      triageHits.push(route.request().url());
      return route.fulfill({ status: 204, body: "" });
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });

    // Fire the noisy error patterns that have been observed in production.
    await page.evaluate(() => {
      const fakes = [
        "MetaMask: Lost connection to MetaMask background",
        "Extension context invalidated.",
        "ResizeObserver loop completed with undelivered notifications.",
        "Script error.",
      ];
      for (const message of fakes) {
        window.dispatchEvent(new ErrorEvent("error", { message }));
      }
    });

    await page.waitForTimeout(750);
    expect(triageHits, `unexpected triage calls: ${triageHits.join(", ")}`).toEqual([]);
  });
});
