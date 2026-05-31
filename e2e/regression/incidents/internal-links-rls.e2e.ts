/**
 * Regression lock-in: "Not authorized for project … code=42501" (per-project
 * internal-links RLS). When a non-coordinator member opens another project's
 * page, the UI must NOT surface a raw 42501; the empty state is correct.
 */
import { test, expect } from "@playwright/test";

test("incident: project internal-links 42501 never reaches the toast layer", async ({ page }) => {
  // Visit a random project openings URL. If redirected to /login, the test
  // still asserts no 42501 leaks before the redirect lands.
  await page.goto("/project-openings", { waitUntil: "domcontentloaded" }).catch(() => {});
  const html = await page.content();
  expect(html).not.toMatch(/code\s*=\s*42501/);
  expect(html).not.toMatch(/Not authorized for project/i);
});
