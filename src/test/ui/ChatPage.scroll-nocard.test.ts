// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/**
 * Regression: the Classic Fleety chat log (ChatPage's role="log" scroll box) became
 * COMPLETELY unscrollable in production — the top of long answers was clipped and unreachable.
 *
 * Root cause (CSS layer): a global auto-card retrofit in src/index.css converts ANY div carrying
 * a card token (bg-muted / border / rounded-*) into a "tf-card" with `overflow: hidden`. Tailwind
 * v3 flattens @layer (no native cascade layers), so that rule's very-high selector specificity
 * beats the `.overflow-y-auto` utility — the log clipped instead of scrolling.
 *
 * Fix: mark the scroll container `data-no-card` (the retrofit's own documented escape hatch),
 * which restores `overflow-y: auto`.
 *
 * jsdom has no layout/cascade engine, so we assert the thing that DRIVES the cascade here:
 * whether the messages element matches the retrofit selector. The selector is read from the real
 * index.css so the test tracks the actual rule.
 *
 * Covers: src/pages/ChatPage.tsx, src/index.css
 */
const here = dirname(fileURLToPath(import.meta.url));
const indexCss = readFileSync(resolve(here, "../../index.css"), "utf8");

// The auto-card retrofit rule — identified by the start of its selector group. We slice from there
// to the opening brace to get the full (multi-variant) selector used for matching.
const SELECTOR_START =
  ':where(div, section, article, aside, main, header, footer, nav)[class*="bg-card"]';
const startIdx = indexCss.indexOf(SELECTOR_START);
const retrofitSelector = indexCss.slice(startIdx, indexCss.indexOf("{", startIdx)).trim();

// The exact classes on ChatPage's chat-log scroll container.
const LOG_CLASSES =
  "flex-1 min-h-0 overflow-y-auto rounded-lg border bg-muted/20 p-4 space-y-5 mb-4";

function makeLog(optOut: boolean): HTMLDivElement {
  const el = document.createElement("div");
  el.className = LOG_CLASSES;
  el.setAttribute("role", "log");
  if (optOut) el.setAttribute("data-no-card", "");
  return el;
}

describe("Classic chat log is exempt from the auto-card overflow:hidden retrofit", () => {
  it("locates the retrofit rule and its data-no-card escape hatch in index.css", () => {
    expect(startIdx).toBeGreaterThanOrEqual(0);
    expect(retrofitSelector).toContain(":not([data-no-card])");
  });

  it("WITHOUT data-no-card the log matches the retrofit (would get overflow:hidden → unscrollable)", () => {
    expect(makeLog(false).matches(retrofitSelector)).toBe(true);
  });

  it("WITH data-no-card the log is exempt (keeps overflow-y:auto → scrollable)", () => {
    expect(makeLog(true).matches(retrofitSelector)).toBe(false);
  });
});
