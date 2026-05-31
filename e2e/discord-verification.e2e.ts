import { test, expect } from "./playwright-fixture";

/**
 * BDD Scenarios covered:
 * DISCORD-LINKING-EXPLICIT-CANDIDATE-SELECTION-1 — Discord accounts are never auto-linked from search results.
 */

test.describe("Discord verification explicit selection", () => {
  test("shows matching Discord members but does not link until the user selects one", async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("tfn.device_id.v1", "playwright-discord-explicit-selection");
    });

    await page.route("**/functions/v1/resolve-discord-id", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          discord_user_id: "1234567890",
          requires_confirmation: true,
          candidates: [
            {
              id: "1234567890",
              username: "morgan",
              global_name: "Morgan Wrong Account",
              nick: null,
              avatar: null,
            },
          ],
        }),
      });
    });

    await page.route("**/rest/v1/profiles**", async (route) => {
      if (route.request().method() === "PATCH") {
        throw new Error("Profile must not be patched until a candidate is clicked.");
      }
      await route.fallback();
    });

    await page.goto("/courses/connect-discord");
    await page.waitForLoadState("networkidle").catch(() => {});

    const yesButton = page.getByRole("button", { name: /yes, i'm in discord/i });
    if (!(await yesButton.isVisible().catch(() => false))) {
      test.skip(true, "Discord verification requires an authenticated profile in this environment.");
    }

    await yesButton.click();
    await page.getByLabel(/discord username or display name/i).fill("morgan");
    await page.getByRole("button", { name: /^verify$/i }).click();

    await expect(page.getByText(/we found similar members/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /select morgan wrong account/i })).toBeVisible();
    await expect(page.getByText(/discord connected/i)).toHaveCount(0);
  });
});
