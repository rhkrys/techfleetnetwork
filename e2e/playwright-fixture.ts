/**
 * Playwright fixture bridge for tests under e2e/.
 *
 * Self-contained re-export of @playwright/test so subdirectory specs can
 * import via stable relative paths (../playwright-fixture, ../../playwright-fixture)
 * without traversing above the repo root in any CI checkout layout.
 */
export { test, expect } from "@playwright/test";
export type {
  BrowserContext,
  ConsoleMessage,
  Locator,
  Page,
  Request,
} from "@playwright/test";
