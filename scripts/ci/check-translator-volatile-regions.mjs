#!/usr/bin/env node
// TRANSLATOR-VOLATILE-003: Fail CI if any JSX file adds an aria-live region or
// a volatile role (status/alert/log/timer) without also carrying data-no-translate,
// translate="no", or sitting inside a component on the allow-list.
//
// Also warns on new occurrences of the legacy boolean `n` opt-out attribute —
// the runtime translator honors it for back-compat but new code must use
// data-no-translate (see mem://constraints/translator-volatile-regions).
//
// Source-scan only — no DB, no env vars required.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");

// Components that internally render aria-live but are known-safe (translator
// already skips them, or they only render translated keys via t()).
const ALLOW_FILES = new Set([
  "src/components/LiveAnnouncer.tsx",   // role+aria-live wrappers; child <span> empty until announce()
  "src/components/ui/AutosaveStatus.tsx", // already carries data-no-translate
]);

const VOLATILE_RE = /\b(aria-live\s*=\s*["'](polite|assertive)["']|role\s*=\s*["'](status|alert|log|timer)["'])/;
const SAFE_RE = /(data-no-translate|translate\s*=\s*["']no["'])/;
const LEGACY_N_RE = /<[A-Za-z][^>]*\s+n(\s|=|>|\/)/g;

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === "__tests__") continue;
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) yield* walk(p);
    else if (/\.(tsx|jsx)$/.test(entry)) yield p;
  }
}

const offenders = [];
const legacyN = [];

for (const file of walk(SRC)) {
  const rel = relative(ROOT, file);
  if (ALLOW_FILES.has(rel)) continue;
  const src = readFileSync(file, "utf8");
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (VOLATILE_RE.test(line)) {
      // Look in a small window for the safety attr (props often span lines)
      const window = lines.slice(Math.max(0, i - 6), Math.min(lines.length, i + 6)).join("\n");
      if (!SAFE_RE.test(window)) {
        offenders.push(`${rel}:${i + 1}  ${line.trim()}`);
      }
    }
    let m;
    LEGACY_N_RE.lastIndex = 0;
    while ((m = LEGACY_N_RE.exec(line))) {
      legacyN.push(`${rel}:${i + 1}  ${line.trim().slice(0, 160)}`);
    }
  }
}

if (legacyN.length) {
  console.warn(`[check-translator-volatile-regions] ${legacyN.length} legacy \`n\` attribute(s); prefer data-no-translate:`);
  for (const m of legacyN) console.warn("  " + m);
}

if (offenders.length) {
  console.error(`\n[check-translator-volatile-regions] FAIL — ${offenders.length} volatile region(s) missing data-no-translate / translate="no":`);
  for (const o of offenders) console.error("  " + o);
  console.error(`\nFix: add data-no-translate (and translate="no") on the element carrying aria-live/role=status — the runtime DOM translator mutates text nodes inside these regions and races React's reconciler (NotFoundError: removeChild). See mem://constraints/translator-volatile-regions.`);
  process.exit(1);
}

console.log("[check-translator-volatile-regions] OK");
