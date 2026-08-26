// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/**
 * Regression: the Classic Fleety chat log (ChatPage's role="log" scroll box) became
 * completely unscrollable in production — the top of long answers was clipped and unreachable.
 *
 * Root cause (CSS layer): a global auto-card retrofit in src/index.css converts ANY div carrying
 * a card token (bg-muted / border / rounded-*) into a "tf-card" with `overflow: hidden`. Tailwind
 * v3 flattens @layer (no native cascade layers), so that rule's very-high selector specificity
 * beats the `.overflow-y-auto` utility — the log clipped instead of scrolling.
 *
 * Fix (root cause, right layer): a live log/scroll region must never be auto-carded, so `role="log"`
 * is excluded from the retrofit — the same treatment already given to other live/interactive roles
 * (alert, status, dialog, tab, …). Any role="log" keeps overflow-y:auto and stays scrollable.
 *
 * jsdom has no layout/cascade engine, so we assert what DRIVES the cascade here: whether an element
 * matches the retrofit selector, which is read from the real index.css so the test tracks the rule.
 *
 * Covers: src/index.css, src/pages/ChatPage.tsx
 */
const here = dirname(fileURLToPath(import.meta.url));
const indexCss = readFileSync(resolve(here, "../../index.css"), "utf8");

// The auto-card retrofit rule — slice from the start of its selector group to the opening brace to
// get the full (multi-variant) selector used for matching.
const SELECTOR_START =
  ':where(div, section, article, aside, main, header, footer, nav)[class*="bg-card"]';
const startIdx = indexCss.indexOf(SELECTOR_START);
const retrofitSelector = indexCss.slice(startIdx, indexCss.indexOf("{", startIdx)).trim();

// The exact classes on ChatPage's chat-log scroll container.
const LOG_CLASSES =
  "flex-1 min-h-0 overflow-y-auto rounded-lg border bg-muted/20 p-4 space-y-5 mb-4";

function el(className: string, role?: string): HTMLDivElement {
  const node = document.createElement("div");
  node.className = className;
  if (role) node.setAttribute("role", role);
  return node;
}

describe("auto-card retrofit excludes live log/scroll regions", () => {
  it("locates the retrofit rule and confirms it now excludes role=log", () => {
    expect(startIdx).toBeGreaterThanOrEqual(0);
    expect(retrofitSelector).toContain(':not([role="log"])');
  });

  it("a card-styled role=log scroll box is EXEMPT → keeps overflow-y:auto → scrollable", () => {
    expect(el(LOG_CLASSES, "log").matches(retrofitSelector)).toBe(false);
  });

  it("a genuine card (no live-region role) still MATCHES → exclusion not over-broadened", () => {
    expect(el("rounded-lg border bg-card p-4").matches(retrofitSelector)).toBe(true);
  });
});
