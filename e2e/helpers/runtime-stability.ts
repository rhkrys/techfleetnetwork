import { expect, type ConsoleMessage, type Page, type Request } from "@playwright/test";

const IGNORED_CONSOLE_PATTERNS = [
  /favicon/i,
  /ResizeObserver loop completed/i,
  /Download the React DevTools/i,
  // Third-party CookieYes preview-domain notice — out of our control in CI
  /cookieyes/i,
  /website URL has changed/i,
];

const FATAL_CONSOLE_PATTERNS = [
  /Failed to fetch dynamically imported module/i,
  /Loading chunk .* failed/i,
  /ChunkLoadError/i,
  /Script error/i,
  /Uncaught/i,
  /Unhandled Promise Rejection/i,
  /useAuth must be used within AuthProvider/i,
];

const FAILED_REQUEST_PATTERNS = [
  /\/assets\//i,
  /node_modules/i,
  /\.js(\?|$)/i,
  /\.css(\?|$)/i,
  /\.json(\?|$)/i,
];

export interface RuntimeIssueCollector {
  errors: string[];
  dispose: () => void;
}

function isIgnored(message: string) {
  return IGNORED_CONSOLE_PATTERNS.some((pattern) => pattern.test(message));
}

export function collectRuntimeIssues(page: Page): RuntimeIssueCollector {
  const errors: string[] = [];

  const onPageError = (error: Error) => {
    const message = error.message || String(error);
    if (!isIgnored(message)) errors.push(`pageerror: ${message}`);
  };

  const onConsole = (message: ConsoleMessage) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (isIgnored(text)) return;
    if (FATAL_CONSOLE_PATTERNS.some((pattern) => pattern.test(text))) {
      errors.push(`console error: ${text}`);
    }
  };

  const onRequestFailed = (request: Request) => {
    const url = request.url();
    if (!FAILED_REQUEST_PATTERNS.some((pattern) => pattern.test(url))) return;
    errors.push(`request failed: ${url} (${request.failure()?.errorText ?? "unknown"})`);
  };

  page.on("pageerror", onPageError);
  page.on("console", onConsole);
  page.on("requestfailed", onRequestFailed);

  return {
    errors,
    dispose: () => {
      page.off("pageerror", onPageError);
      page.off("console", onConsole);
      page.off("requestfailed", onRequestFailed);
    },
  };
}

export async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const tolerance = 2;
    const offenders = Array.from(document.body.querySelectorAll<HTMLElement>("*"))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          id: element.id,
          className: typeof element.className === "string" ? element.className.slice(0, 160) : "",
          text: element.innerText?.replace(/\s+/g, " ").slice(0, 80) ?? "",
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
        };
      })
      .filter(
        (item) => item.width > 0 && (item.right > width + tolerance || item.left < -tolerance)
      )
      .slice(0, 8);

    return {
      viewportWidth: width,
      scrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      offenders,
    };
  });

  expect(
    overflow.scrollWidth,
    `Horizontal page overflow at ${page.url()}: ${JSON.stringify(overflow, null, 2)}`
  ).toBeLessThanOrEqual(overflow.viewportWidth + 2);
}

export async function expectFocusableControlsAreVisible(page: Page) {
  const hiddenFocusable = await page.evaluate(() => {
    const selector = [
      "a[href]",
      "button",
      // type=hidden inputs are never rendered or keyboard-focusable. Cloudflare
      // Turnstile injects one (id="cf-chl-widget-*_response") on every auth
      // page; counting it produced a false "hidden focusable control" failure.
      "input:not([type='hidden'])",
      "select",
      "textarea",
      "[tabindex]:not([tabindex='-1'])",
      "[role='button']",
      "[role='link']",
    ].join(",");

    return Array.from(document.querySelectorAll<HTMLElement>(selector))
      .filter((element) => {
        if (element.hasAttribute("disabled") || element.getAttribute("aria-hidden") === "true")
          return false;
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return (
          style.visibility === "hidden" ||
          style.display === "none" ||
          rect.width === 0 ||
          rect.height === 0
        );
      })
      .slice(0, 8)
      .map((element) => ({
        tag: element.tagName.toLowerCase(),
        id: element.id,
        text: element.innerText?.replace(/\s+/g, " ").slice(0, 80) ?? "",
        ariaLabel: element.getAttribute("aria-label"),
      }));
  });

  expect(
    hiddenFocusable,
    `Focusable controls must remain visible and reachable at ${page.url()}: ${JSON.stringify(hiddenFocusable, null, 2)}`
  ).toHaveLength(0);
}

export async function expectKeyboardFocusVisible(page: Page) {
  await page.keyboard.press("Tab");
  const active = await page.evaluate(() => {
    const element = document.activeElement as HTMLElement | null;
    if (!element || element === document.body) return null;
    const rect = element.getBoundingClientRect();
    return {
      tag: element.tagName.toLowerCase(),
      id: element.id,
      text: element.innerText?.replace(/\s+/g, " ").slice(0, 80) ?? "",
      width: rect.width,
      height: rect.height,
      top: rect.top,
      left: rect.left,
    };
  });

  if (!active) return;
  expect(
    active.width,
    `Focused element has no width at ${page.url()}: ${JSON.stringify(active)}`
  ).toBeGreaterThan(0);
  expect(
    active.height,
    `Focused element has no height at ${page.url()}: ${JSON.stringify(active)}`
  ).toBeGreaterThan(0);
}

export async function expectNoRuntimeIssues(collector: RuntimeIssueCollector, context: string) {
  expect(
    collector.errors,
    `Runtime stability issues in ${context}:\n${collector.errors.join("\n")}`
  ).toHaveLength(0);
}
