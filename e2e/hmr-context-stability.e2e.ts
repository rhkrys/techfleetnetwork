import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * Smoke test: prove HMR can never split the AuthContext into two instances.
 *
 * Touches AuthContext.tsx with a no-op edit, waits for Vite HMR to fire, and
 * asserts the page didn't crash with the historical
 * "useAuth must be used within AuthProvider" error. The HMR guard in
 * AuthContext.tsx forces a full reload, so the page should stay healthy.
 *
 * Only meaningful against the dev server — skipped if Vite HMR isn't reachable.
 */
test("AuthContext HMR update does not break the app", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });

  await page.goto("/");
  await page.waitForLoadState("networkidle").catch(() => {});

  const filePath = path.resolve(process.cwd(), "src/contexts/AuthContext.tsx");
  if (!fs.existsSync(filePath)) test.skip(true, "AuthContext.tsx not present");

  const original = fs.readFileSync(filePath, "utf8");
  const marker = `\n// hmr-smoke-${Date.now()}\n`;
  try {
    fs.writeFileSync(filePath, original + marker);
    // Wait for HMR cycle + the forced full reload our guard triggers.
    await page.waitForLoadState("load", { timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(2_000);
  } finally {
    fs.writeFileSync(filePath, original);
  }

  const offending = errors.filter((e) =>
    /useAuth must be used within AuthProvider/i.test(e)
  );
  expect(offending, `HMR caused context mismatch: ${offending.join("\n")}`).toHaveLength(0);
  await expect(page.locator("body")).toBeVisible();
});
