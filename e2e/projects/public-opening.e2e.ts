import { test, expect } from "@playwright/test";

/**
 * BDD W1-POD-001 — Anonymous can view a public project opening.
 *
 * The previous version of this spec was a FALSE GREEN. It navigated to
 * `/projects`, which is not in the route table (src/App.tsx), so React Router
 * rendered the `*` -> NotFound element inside AppLayout. The URL assertion
 * `/\/projects(\/|\?|$)/` still matched and the `main` landmark still
 * rendered, so the spec passed while proving only that the 404 page has a
 * <main>. It documented a desired URL instead of testing a real one.
 *
 * The route that is actually public today is `/project-openings/:projectId`
 * (App.tsx — the detail route has no ProtectedRoute wrapper, unlike the
 * listing route above it), so that is what this asserts. The public
 * `/projects` catalog is Epic 03 Phase 3 and is marked fixme below rather
 * than silently passing on the 404 page.
 */

// The suite has no seeded project fixture (see e2e/a11y/routes.ts, where the
// opening routes are skipped for the same reason). A placeholder id is enough
// here: this spec tests REACHABILITY — that the route is not behind an auth
// wall — not the rendered project content.
const PLACEHOLDER_PROJECT_ID = "00000000-0000-0000-0000-000000000000";

test.describe("Public project openings (BDD W1-POD-001)", () => {
  test.describe.configure({ retries: 1, mode: "parallel" });

  test("anonymous visitor reaches the public opening route without an auth redirect", async ({
    page,
  }) => {
    await page.goto(`/project-openings/${PLACEHOLDER_PROJECT_ID}`, {
      waitUntil: "domcontentloaded",
    });

    // Wait for the SPA to boot BEFORE asserting on the URL — a client-side
    // auth redirect lands after hydration, so asserting too early would pass
    // on a page that is about to bounce to /login.
    await expect(page.locator("main, [role='main']").first()).toBeVisible({
      timeout: 10_000,
    });

    // 1. Publicly reachable: still on the opening URL, never sent to sign-in.
    await expect(page).toHaveURL(new RegExp(`/project-openings/${PLACEHOLDER_PROJECT_ID}`));

    // 2. Not the router's 404 fallback. This is the guard whose absence let
    //    the previous version pass on the NotFound page; a `main` landmark
    //    alone proves nothing, because NotFound renders inside AppLayout too.
    //    Anchor on the "404" heading, matching e2e/navigation.e2e.ts.
    await expect(page.getByRole("heading", { name: "404" })).toHaveCount(0);
  });

  // Epic 03 Phase 3 — docs/epics/03-public-catalog-access.md. `/projects` does
  // not exist yet; asserting against it today passes on the 404 page, which is
  // exactly the false green this file was rewritten to remove. Unskip when the
  // public catalog route lands.
  test.fixme("anonymous visitor can browse the public /projects catalog", async ({ page }) => {
    await page.goto("/projects", { waitUntil: "domcontentloaded" });
    await expect(page.locator("main, [role='main']").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("heading", { name: "404" })).toHaveCount(0);
  });
});
