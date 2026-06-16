import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Regression guard: tab switches (focus/visibilitychange/pageshow) must
 * NEVER cause a full page reload, and HMR handlers on context modules
 * must not force window.location.reload() either. See plan
 * .lovable/plan.md "Fix tab-switch reloads permanently".
 *
 * Extended 2026-06-16 (NO-RELOAD-TAB-001, NO-RELOAD-TAB-002,
 * ACTIVITY-LOG-STATE-001) to lock in the permanent fix for the
 * `/admin/activity-log` reload-on-tab-return symptom.
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

  // NO-RELOAD-TAB-002 — MfaEnforcementGuard's focus listener (which could
  // window.location.replace("/login") on a transient null session) is gone.
  it("MfaEnforcementGuard does not attach a focus or visibilitychange listener", () => {
    const src = read("src/components/MfaEnforcementGuard.tsx");
    expect(src).not.toMatch(/addEventListener\(\s*["']focus["']/);
    expect(src).not.toMatch(/addEventListener\(\s*["']visibilitychange["']/);
    // SPA navigation only — full-page navigations destroy admin grid state.
    expect(src).not.toMatch(/window\.location\.replace\(/);
    // The cancel branch must use react-router's navigate(), not a hard nav.
    expect(src).toMatch(/useNavigate/);
  });

  // ACTIVITY-LOG-STATE-001 — Activity Log state must come from the
  // reload-safe hook, NOT bare useState that disappears on remount.
  it("ActivityLogPage state is reload-safe via useSyncedTableState", () => {
    const src = read("src/pages/ActivityLogPage.tsx");
    expect(src).toMatch(/useSyncedTableState\(\s*["']activity-log["']/);
    expect(src).toMatch(/useSyncedScrollPosition\(\s*["']activity-log["']/);
    // Defense against accidental regression to bare useState for these keys.
    expect(src).not.toMatch(/useState<string>\(\s*"all"\s*\)/);
    expect(src).not.toMatch(/const\s+\[\s*page\s*,\s*setPage\s*\]\s*=\s*useState\(/);
  });
});
