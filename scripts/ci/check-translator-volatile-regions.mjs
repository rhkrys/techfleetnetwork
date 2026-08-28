#!/usr/bin/env node
// TRANSLATOR-VOLATILE-003: Fail CI if any JSX file adds an aria-live region or a
// volatile role (status/alert/log/timer) without data-no-translate / translate="no",
// unless the file is on the snapshot allow-list (regions the runtime translator
// already skips via shouldSkipElement).
//
// Source-scan only. Scans .tsx/.jsx under src, skipping node_modules/dist/__tests__
// via the harness `excludeDir`. Scan/fail-closed/zero-scan/evidence owned by the
// shared harness (_guard.mjs), which also normalizes relPath to forward slashes so
// the allow-list matches on every OS. (The old guard compared native backslash paths
// on Windows, so the forward-slash allow-list never matched and it reported a phantom
// "127" locally — CI, on forward-slash Linux paths, was always 0.)
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runScanGuard } from "./_guard.mjs";

const SNAPSHOT = JSON.parse(
  readFileSync(join(process.cwd(), "scripts/ci/translator-volatile-regions.snapshot.json"), "utf8")
);
const ALLOW_FILES = new Set([
  ...SNAPSHOT.allow_files,
  "src/components/LiveAnnouncer.tsx",
  "src/components/ui/AutosaveStatus.tsx",
]);

const VOLATILE_RE =
  /\b(aria-live\s*=\s*["'](polite|assertive)["']|role\s*=\s*["'](status|alert|log|timer)["'])/;
const SAFE_RE = /(data-no-translate|translate\s*=\s*["']no["'])/;

runScanGuard({
  name: "check-translator-volatile-regions",
  roots: ["src"],
  include: /\.(tsx|jsx)$/,
  exclude: null, // scan .test.tsx outside __tests__ too, as the original walk did
  excludeDir: /^(node_modules|dist|__tests__)$/,
  rule(src, relPath) {
    if (ALLOW_FILES.has(relPath)) return [];
    const out = [];
    const lines = src.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (VOLATILE_RE.test(lines[i])) {
        // Props often span lines — check a small window for the safety attr.
        const window = lines.slice(Math.max(0, i - 6), Math.min(lines.length, i + 6)).join("\n");
        if (!SAFE_RE.test(window)) out.push({ line: i + 1, text: lines[i].trim() });
      }
    }
    return out;
  },
});
