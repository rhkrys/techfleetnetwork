/**
 * Shared guard harness — the ONE implementation of "scan files for a rule".
 *
 * Root-cause fix for the false-green class (decisions.md §6): every file-scanning
 * guard used to hand-roll its own directory walk + exit logic, and ~half got
 * fail-closed / zero-scan / evidence wrong. This harness owns all of that so a
 * guard author supplies ONLY the rule and cannot produce a false green:
 *
 *   - a missing/unreadable root  → exit 2  (fail closed; never a silent pass)
 *   - zero files matched         → exit 1  (no vacuous pass)
 *   - any violation from `rule`  → exit 1  (with file:line detail)
 *   - otherwise                  → exit 0  AND print a substantial evidence line
 *                                          ("OK — N files scanned, 0 violations")
 *
 * The meta-guard (check-ci-guard-integrity.mjs) forbids a guard from hand-rolling
 * its own recursive readdir; scanning guards MUST come through here.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * @param {object} opts
 * @param {string}   opts.name     Guard name, used in every message.
 * @param {string[]} opts.roots    Repo-relative dirs to scan (all must exist).
 * @param {RegExp}   [opts.include] Filename filter (default: /\.(ts|tsx)$/).
 * @param {RegExp}   [opts.exclude] Filename skip (default: /\.test\.(ts|tsx)$/).
 * @param {RegExp}   [opts.excludeDir] Directory NAME skip during the walk (e.g.
 *        /^(node_modules|dist|__tests__|_shared)$/). Centralizes dir-exclusion so
 *        guards don't hand-roll it (default: /^(node_modules|dist|\.next|coverage)$/).
 * @param {(src: string, relPath: string) => Array<string | {line?: number, text: string}>} opts.rule
 *        Returns violations for one file ([] = clean). A string is used verbatim;
 *        an object is rendered as `relPath:line  text`.
 * @param {boolean}  [opts.allowZero] Set true ONLY for a detector where an empty
 *        set is a genuine no-op (e.g. a duplicate detector). Default false.
 * @param {(scanned: number, files: string[]) => string} [opts.summary]
 *        Optional extra detail appended to the OK line (e.g. "292 edge, 711 migrations").
 */
export function runScanGuard(opts) {
  const {
    name,
    roots,
    include = /\.(ts|tsx)$/,
    exclude = /\.test\.(ts|tsx)$/,
    excludeDir = /^(node_modules|dist|\.next|coverage)$/,
    rule,
    allowZero = false,
    summary,
  } = opts;

  if (!name || !Array.isArray(roots) || roots.length === 0 || typeof rule !== "function") {
    console.error(
      `✖ runScanGuard: misconfigured guard (name, roots[], rule required). Failing closed.`
    );
    process.exit(2);
  }

  const files = [];
  for (const root of roots) {
    const abs = join(process.cwd(), root);
    let collected;
    try {
      collected = walk(abs, include, exclude, excludeDir);
    } catch (e) {
      console.error(
        `✖ ${name}: cannot scan ${root} — ${e.message}. Failing closed (a guard must never pass without inspecting its target).`
      );
      process.exit(2);
    }
    files.push(...collected);
  }

  if (files.length === 0 && !allowZero) {
    console.error(
      `✖ ${name}: matched 0 files under ${roots.join(", ")} — path moved or filter wrong? Failing closed rather than passing vacuously.`
    );
    process.exit(1);
  }

  const violations = [];
  for (const abs of files) {
    const rel = relative(process.cwd(), abs).replace(/\\/g, "/");
    let src;
    try {
      src = readFileSync(abs, "utf8");
    } catch (e) {
      console.error(`✖ ${name}: cannot read ${rel} — ${e.message}. Failing closed.`);
      process.exit(2);
    }
    const found = rule(src, rel) || [];
    for (const v of found) {
      violations.push(typeof v === "string" ? v : `${rel}${v.line ? `:${v.line}` : ""}  ${v.text}`);
    }
  }

  const extra = summary ? ` (${summary(files.length, files)})` : "";
  if (violations.length) {
    console.error(
      `✖ ${name}: ${violations.length} violation(s) across ${files.length} files scanned${extra}:`
    );
    for (const v of violations) console.error("  - " + v);
    process.exit(1);
  }

  console.log(`✓ ${name}: OK — ${files.length} files scanned, 0 violations${extra}.`);
}

/**
 * Recursively collect files under `dir`. `include`/`exclude` may be a RegExp
 * (tested against the file BASENAME — the common case) or a function of the
 * repo-relative forward-slash path (for path-aware selection, e.g. "all files
 * under e2e/"). `excludeDir` skips directory names during descent.
 */
function walk(dir, include, exclude, excludeDir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const s = statSync(full);
    if (s.isDirectory()) {
      if (excludeDir && excludeDir.test(name)) continue;
      out.push(...walk(full, include, exclude, excludeDir));
      continue;
    }
    const rel = relative(process.cwd(), full).replace(/\\/g, "/");
    const excluded =
      typeof exclude === "function" ? exclude(rel) : !!(exclude && exclude.test(name));
    if (excluded) continue;
    const included = typeof include === "function" ? include(rel) : !include || include.test(name);
    if (!included) continue;
    out.push(full);
  }
  return out;
}

/** Line number (1-based) of a substring index in `src` — for building violations. */
export function lineOf(src, index) {
  return src.slice(0, index).split("\n").length;
}
