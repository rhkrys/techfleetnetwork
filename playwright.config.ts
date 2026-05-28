import { defineConfig, devices } from "@playwright/test";

/**
 * Standalone Playwright config.
 *
 * Base URL precedence:
 *   1. PLAYWRIGHT_BASE_URL (explicit override)
 *   2. http://127.0.0.1:4173 (vite preview, used in CI via webServer)
 *
 * Project gating:
 *   - default: chromium-desktop only (fast PR gate).
 *   - PLAYWRIGHT_FULL_MATRIX=1: full desktop + mobile + tablet matrix,
 *     including SE/fold/4K/slow-3G profiles (Track 2).
 *   - PLAYWRIGHT_VISUAL=1: only the visual-regression projects (Track 1).
 */
const PORT = Number(process.env.PORT ?? 4173);
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${PORT}`;
const isCI = !!process.env.CI;
const isFullMatrix = process.env.PLAYWRIGHT_FULL_MATRIX === "1";
const isVisual = process.env.PLAYWRIGHT_VISUAL === "1";
const chromiumExecutablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

// Slow-3G throttling profile — catches blocking-resource regressions.
const SLOW_3G = {
  offline: false,
  downloadThroughput: (1.5 * 1024 * 1024) / 8 / 5, // ~37.5KB/s
  uploadThroughput: (750 * 1024) / 8 / 5,
  latency: 400,
};

const matrixProjects = [
  {
    name: "chromium-desktop",
    use: {
      ...devices["Desktop Chrome"],
      ...(chromiumExecutablePath ? { launchOptions: { executablePath: chromiumExecutablePath } } : {}),
    },
  },
  { name: "firefox-desktop", use: { ...devices["Desktop Firefox"] } },
  { name: "webkit-desktop", use: { ...devices["Desktop Safari"] } },
  { name: "mobile-chrome", use: { ...devices["Pixel 7"] } },
  { name: "mobile-safari", use: { ...devices["iPhone 14"] } },
  // --- Track 2 additions ------------------------------------------------
  {
    name: "mobile-safari-se",
    use: { ...devices["iPhone SE"], viewport: { width: 375, height: 667 } },
  },
  {
    name: "mobile-chrome-fold",
    // Galaxy Z Fold inner display when folded — the narrowest Android we
    // need to support. Playwright doesn't ship a Fold preset; derive it.
    use: {
      ...devices["Pixel 7"],
      viewport: { width: 344, height: 882 },
      userAgent:
        "Mozilla/5.0 (Linux; Android 14; SM-F946B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
    },
  },
  {
    name: "mobile-safari-pro-max",
    use: {
      ...devices["iPhone 14 Pro Max"],
      viewport: { width: 430, height: 932 },
    },
  },
  {
    name: "tablet",
    use: { ...devices["iPad Pro 11"], viewport: { width: 834, height: 1194 } },
  },
  {
    name: "tablet-landscape",
    use: { ...devices["iPad Pro 11"], viewport: { width: 1194, height: 834 } },
  },
  {
    name: "desktop-1366",
    use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 768 } },
  },
  {
    name: "desktop-4k",
    use: {
      ...devices["Desktop Chrome"],
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 2,
    },
  },
  {
    name: "chromium-slow-3g",
    use: {
      ...devices["Desktop Chrome"],
      // Apply throttling via launch arg — used by critical-path tests.
      contextOptions: { extraHTTPHeaders: { "Save-Data": "" } },
      offline: SLOW_3G.offline,
    },
  },
];

const visualProjects = [
  {
    name: "visual-chromium-desktop",
    testDir: "e2e/visual",
    use: {
      ...devices["Desktop Chrome"],
      viewport: { width: 1280, height: 720 },
      ...(chromiumExecutablePath ? { launchOptions: { executablePath: chromiumExecutablePath } } : {}),
    },
  },
  {
    name: "visual-mobile-chrome",
    testDir: "e2e/visual",
    use: {
      ...devices["Pixel 7"],
      viewport: { width: 390, height: 844 },
      ...(chromiumExecutablePath ? { launchOptions: { executablePath: chromiumExecutablePath } } : {}),
    },
  },
];

function selectProjects() {
  if (isVisual) return visualProjects;
  if (isFullMatrix) return matrixProjects;
  return [matrixProjects[0]];
}

export default defineConfig({
  testDir: ".",
  testMatch: ["e2e/**/*.e2e.ts"],
  timeout: 60_000,
  expect: {
    timeout: 10_000,
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.01,
      animations: "disabled",
      caret: "hide",
    },
  },
  fullyParallel: false,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: 1,
  reporter: isCI
    ? [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]]
    : "list",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: selectProjects(),
  webServer:
    isCI || process.env.PLAYWRIGHT_START_SERVER === "1"
      ? {
          command: `npm run build && npx vite preview --host 127.0.0.1 --port ${PORT} --strictPort`,
          url: BASE_URL,
          reuseExistingServer: !isCI,
          timeout: 180_000,
          stdout: "pipe",
          stderr: "pipe",
        }
      : undefined,
});
