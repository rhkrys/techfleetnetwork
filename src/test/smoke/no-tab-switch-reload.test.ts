import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Regression guard: tab switches (focus/visibilitychange/pageshow) must
 * NEVER cause a full page reload, and HMR handlers on context modules
 * must not force window.location.reload() either. See plan
 * .lovable/plan.md "Fix tab-switch reloads permanently".
 */

function read(rel: string) {
  return readFileSync(resolve(process.cwd(), rel), "utf8");
}

describe("no auto-reload on tab switch", () => {
  it("deploy-watcher does not listen to focus or visibilitychange", () => {
    const src = read("src/lib/deploy-watcher.ts");
    expect(src).not.toMatch(/addEventListener\(\s*["']focus["']/);
    expect(src).not.toMatch(/addEventListener\(\s*["']visibilitychange["']/);
    expect(src).not.toMatch(/addEventListener\(\s*["']pageshow["']/);
  });

  it("AuthContext HMR handler does not force reload", () => {
    const src = read("src/contexts/AuthContext.tsx");
    const hmrBlock = src.split("import.meta.hot")[1] ?? "";
    expect(hmrBlock).not.toMatch(/location\.reload\(/);
  });

  it("PageHeaderContext HMR handler does not force reload", () => {
    const src = read("src/contexts/PageHeaderContext.tsx");
    const hmrBlock = src.split("import.meta.hot")[1] ?? "";
    expect(hmrBlock).not.toMatch(/location\.reload\(/);
  });
});
