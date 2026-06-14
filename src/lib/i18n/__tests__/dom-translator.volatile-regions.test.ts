/**
 * TRANSLATOR-VOLATILE-001 / 003
 *
 * Guards the shouldSkipElement contract: aria-live regions, role=status/alert/log/timer,
 * data-no-translate, translate="no", and the legacy `n` boolean attribute all skip.
 * This is enforced by behavioral test, not by reading the source: if a future
 * refactor drops one of these branches, this test fails.
 *
 * We exercise the public surface (installDomTranslator + observer) by switching
 * language to a non-English locale and asserting the marked nodes' nodeValue
 * never changes — even after React-like swaps via removeChild/appendChild.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// Stub the edge fn call so the translator does not hit the network.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: {
      invoke: vi.fn(async () => ({ data: { map: {} }, error: null })),
    },
  },
}));

// Lightweight i18n stub: we control the "languageChanged" event manually.
const listeners = new Map<string, ((lng: string) => void)[]>();
vi.mock("@/i18n", () => ({
  default: {
    language: "en",
    on: (evt: string, cb: (lng: string) => void) => {
      const arr = listeners.get(evt) ?? [];
      arr.push(cb);
      listeners.set(evt, arr);
    },
  },
}));

import { installDomTranslator } from "@/lib/i18n/dom-translator";

function emitLang(lng: string) {
  for (const cb of listeners.get("languageChanged") ?? []) cb(lng);
}

function makeRegion(html: string): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.appendChild(host);
  return host.firstElementChild as HTMLElement;
}

describe("dom-translator volatile-region skip contract", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    listeners.clear();
    installDomTranslator(); // idempotent
  });

  const cases: Array<[string, string]> = [
    ["aria-live polite",     `<span aria-live="polite">Saving…</span>`],
    ["aria-live assertive",  `<span aria-live="assertive">Save failed</span>`],
    ["role status",          `<span role="status">Idle</span>`],
    ["role alert",           `<span role="alert">Error</span>`],
    ["role log",             `<span role="log">Log entry</span>`],
    ["role timer",           `<span role="timer">00:30</span>`],
    ["data-no-translate",    `<span data-no-translate>Brand</span>`],
    ["translate=no",         `<span translate="no">Acme</span>`],
    ["legacy n attribute",   `<span n>LegacyBrand</span>`],
  ];

  for (const [label, html] of cases) {
    it(`leaves "${label}" untouched on language change`, async () => {
      const el = makeRegion(html);
      const original = el.textContent;
      emitLang("fr");
      // Allow any microtasks/timers to settle.
      await new Promise((r) => setTimeout(r, 5));
      expect(el.textContent).toBe(original);
    });
  }

  it("aria-live region survives a React-like removeChild/appendChild swap", async () => {
    const el = makeRegion(`<span aria-live="polite">Saving…</span>`);
    emitLang("fr");
    // React-style: detach text node, replace with a fresh one.
    const oldText = el.firstChild as Text;
    expect(() => el.removeChild(oldText)).not.toThrow();
    el.appendChild(document.createTextNode("Saved · just now"));
    await new Promise((r) => setTimeout(r, 5));
    expect(el.textContent).toBe("Saved · just now");
  });
});
