#!/usr/bin/env node
/**
 * GATE-INTEGRITY-001 (meta-guard) — the checks that guard the architecture must
 * themselves never pass falsely, crash instead of verifying, or hand-roll the
 * boilerplate that keeps reintroducing those bugs. Scans every guard in scripts/ci/
 * (except itself and the `_`-prefixed harness) for three defect classes:
 *
 *   1. FALSE GREEN — `exit(0)` inside a `catch`: a swallowed error reports OK while
 *      verifying nothing. (Lived in check-auth-engine-swallow.mjs, a SECURITY guard.)
 *   2. PATH-PORTABILITY CRASH — `new URL(...).pathname`: returns "/C:/…" on Windows,
 *      which path.resolve doubles into "C:\\C:\\…" and the guard crashes instead of
 *      verifying. (Lived in check-triage-actionable-parity.mjs.) Use fileURLToPath.
 *   3. HAND-ROLLED WALK — a guard that reads a directory (readdirSync/readdir) but
 *      does NOT go through the shared harness (_guard.mjs). Recursive content scans
 *      MUST use runScanGuard so fail-closed / zero-scan / evidence are structural.
 *      A genuinely bespoke reader (collision detector, manifest generator, DB/API)
 *      is listed in BESPOKE_DIR_READERS below — a reviewed, named exception.
 *
 * Deliberate fail-open for class 1 opts out with `// ci-guard-integrity-ok: <reason>`
 * on/above the exit line. This guard is itself a model: prints the count scanned and
 * FAILS CLOSED on a missing dir / zero-file scan.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIR = join(process.cwd(), "scripts/ci");
const SELF = "check-ci-guard-integrity.mjs";

// Reviewed, intentionally-bespoke directory readers that legitimately do NOT use
// the scan harness (they read filenames, generate a manifest, or query a DB — not
// a recursive content scan). Adding a guard here is a conscious decision on record.
const BESPOKE_DIR_READERS = new Set([
  "check-adr-number-collision.mjs", // filename collision detector
  "check-migration-version-collision.mjs", // filename collision detector
  "check-edge-function-coverage.mjs", // manifest generator
  "check-legacy-auth-importers.mjs", // snapshot-diff guard with an --update mode + shrink notice (not a per-file rule)
  "check-owasp-coverage.mjs", // reads the OWASP map + SAST config
  "check-triage-actionable-parity.mjs", // reads one TS file + newest matching migration
  "check-migrations-applied.mjs", // Management-API guard; reads migration filenames
  "arch-gate.mjs", // the flagship architecture engine — its own dependency-free scanner, already fail-closed + evidence-bearing
]);

let files;
try {
  // Scope to actual GUARDS (check-* + the arch-gate engine). Utility scripts
  // (run-pre-commit, seed-*, setup-*) and the `_`-prefixed harness are not guards
  // and make no pass/fail verification claim, so they are not subject to this.
  files = readdirSync(DIR).filter(
    (f) => f.endsWith(".mjs") && f !== SELF && (f.startsWith("check-") || f === "arch-gate.mjs")
  );
} catch (e) {
  console.error(`❌ GATE-INTEGRITY-001: cannot read ${DIR}: ${e.message} (failing closed)`);
  process.exit(2);
}

if (files.length === 0) {
  console.error(
    `❌ GATE-INTEGRITY-001: scanned 0 guard scripts under ${DIR} — path moved? Failing closed rather than passing vacuously.`
  );
  process.exit(2);
}

// Comment-stripped view (full-line comments) for the text-pattern checks, so a
// pattern mentioned in an explanatory comment is not itself flagged.
const stripComments = (src) =>
  src
    .split(/\r?\n/)
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join("\n");

const swallow = []; // class 1
const pathBug = []; // class 2
const rawWalk = []; // class 3

for (const f of files) {
  const src = readFileSync(join(DIR, f), "utf8");
  const lines = src.split(/\r?\n/);
  const code = stripComments(src);

  // Class 1: exit(0) inside a catch (brace-matched on raw src).
  const re = /catch\s*\([^)]*\)\s*\{/g;
  let m;
  while ((m = re.exec(src))) {
    const start = m.index + m[0].length;
    let depth = 1;
    let i = start;
    while (i < src.length && depth > 0) {
      const ch = src[i];
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      i++;
    }
    const body = src.slice(start, i - 1);
    const exitMatch = /(?:process\.)?exit\(\s*0\s*\)/.exec(body);
    if (!exitMatch) continue;
    const lineNo = src.slice(0, start + exitMatch.index).split("\n").length;
    if (/ci-guard-integrity-ok:/.test(lines[lineNo - 1] ?? "")) continue;
    if (/ci-guard-integrity-ok:/.test(lines[lineNo - 2] ?? "")) continue;
    swallow.push(`${f}:${lineNo}`);
  }

  // Class 2: new URL(...).pathname (Windows path-portability crash).
  if (/new URL\([^)]*\)\s*\.pathname/.test(code)) pathBug.push(f);

  // Class 3: hand-rolled directory walk not going through the harness.
  const readsDir = /\breaddirSync\b|\breaddir\s*\(/.test(code);
  const usesHarness = /from\s+["']\.\/_guard\.mjs["']/.test(code);
  if (readsDir && !usesHarness && !BESPOKE_DIR_READERS.has(f)) rawWalk.push(f);
}

const problems = [];
if (swallow.length)
  problems.push([
    "exit(0) inside a catch — a swallowed error becomes a false green:",
    swallow,
    "Fail closed (exit non-zero), or annotate a deliberate fail-open with `// ci-guard-integrity-ok: <reason>`.",
  ]);
if (pathBug.length)
  problems.push([
    "new URL(...).pathname — crashes on Windows (C:\\C:\\…) instead of verifying:",
    pathBug,
    "Use `fileURLToPath(import.meta.url)` (node:url) to derive paths.",
  ]);
if (rawWalk.length)
  problems.push([
    "reads a directory without the shared harness (hand-rolled walk):",
    rawWalk,
    "Use runScanGuard from ./_guard.mjs (it owns fail-closed/zero-scan/evidence). If genuinely bespoke, add it to BESPOKE_DIR_READERS with a reason.",
  ]);

if (problems.length) {
  console.error("❌ GATE-INTEGRITY-001: guard integrity violation(s):");
  for (const [title, items, fix] of problems) {
    console.error(`\n  ${title}`);
    for (const it of items) console.error(`    - ${it}`);
    console.error(`  Fix: ${fix}`);
  }
  process.exit(1);
}

console.log(
  `✓ GATE-INTEGRITY-001: ${files.length} guard scripts scanned — none swallow an error into exit(0), use new URL().pathname, or hand-roll a directory walk.`
);
