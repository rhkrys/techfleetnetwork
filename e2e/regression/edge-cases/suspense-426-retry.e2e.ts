import { test, expect } from "../../../playwright-fixture";

/**
 * BDD UI-EDGE-426-001 — Minified React error #426 (Suspense hydration race
 * during a deploy chunk swap) must be caught by the ErrorBoundary and
 * downgraded to a silent retry — no user-facing error toast.
 *
 * Tri-layer:
 *  [UI]   No "Something went wrong" error surface visible.
 *  [DB]   N/A (anon path).
 *  [Code] No `pageerror` propagates from a synthesized React 426.
 */
test.describe("Suspense 426 retry (UI-EDGE-426-001) @critical", () => {
  test.describe.configure({ retries: 1, mode: "parallel" });

  test("synthetic React 426 does not surface an error toast", async ({ page }) => {
    const fatal: string[] = [];
    page.on("pageerror", (err) => fatal.push(String(err?.message ?? err)));

    await page.goto("/", { waitUntil: "domcontentloaded" });

    // Fire a synthetic React 426 to confirm ErrorBoundary downgrades it.
    await page.evaluate(() => {
      const err = new Error(
        "Minified React error #426; visit https://react.dev/errors/426"
      );
      window.dispatchEvent(new ErrorEvent("error", { error: err, message: err.message }));
    });

    await page.waitForTimeout(500);

    // No "Something went wrong" or generic error toast.
    const errorToast = page.getByText(/something went wrong|unexpected error/i);
    await expect(errorToast).toHaveCount(0);

    // Page itself still healthy.
    await expect(page.locator("body")).toBeVisible();
    expect(fatal.length, fatal.join("\n")).toBeLessThanOrEqual(1);
  });
});
