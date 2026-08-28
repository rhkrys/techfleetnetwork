#!/usr/bin/env node
/**
 * ADR-NUMBER-001 guard: no two files in docs/adr/ may share a `NNNN` number
 * (the numeric prefix in `<NNNN>-<slug>.md`).
 *
 * Why: an ADR's number is its identity — cross-references ("see ADR-0012"),
 * links, and the historical record all key on it. Two ADRs with the same number
 * make every such reference ambiguous and silently break `docs/adr/NNNN-*.md`
 * links. This is the SAME failure mode as duplicate migration version prefixes
 * (see check-migration-version-collision.mjs): parallel PRs each grab "the next
 * number" against a base that lacks the other's ADR, both go green, and they
 * collide on merge. It has already happened four times on `main`
 * (0009/0013/0014/0016) because — unlike migrations — nothing guarded it.
 *
 * On a `pull_request` run CI checks out the PR merged into base, so this scan
 * sees the PR's ADR alongside base's and catches a cross-PR collision at PR time
 * (provided "require branches up to date before merging" is on).
 *
 * Fix when it fires: renumber your ADR to a unique number greater than the current
 * max — `max(all existing numbers) + 1` — and update any references to it. Never
 * reuse a number.
 *
 * GRANDFATHERED: the pairs that predate this guard are allowed to remain doubled
 * (renumbering merged, cross-referenced ADRs would break existing links). The
 * guard blocks only NEW collisions — a fresh number, or a THIRD file on a
 * grandfathered number. As these are cleaned up, remove them from the set below.
 */
import { readdirSync } from "node:fs";

const DIR = "docs/adr";

// number -> how many files are historically allowed to share it (predate the guard)
const GRANDFATHERED = new Map([
  ["0013", 2], // 0013-consent-ledger-source-of-truth + 0013-fleety-retrieval-lexical-fallback
  ["0014", 2], // 0014-ghost-email-octopus-sync-topology + 0014-fleety-file-uploads
  ["0016", 2], // 0016-email-tiering-and-notify-announcements-retirement + 0016-tal-9000-future-mode-terminal
]);

let files;
try {
  files = readdirSync(DIR).filter((f) => f.endsWith(".md"));
} catch (e) {
  console.error(`❌ ADR-NUMBER-001: cannot read ${DIR}: ${e.message}`);
  process.exit(1);
}

const byNumber = new Map();
const malformed = [];

for (const f of files) {
  if (f.toLowerCase() === "readme.md") continue; // the index, not an ADR
  const m = f.match(/^([0-9]{4})-/);
  if (!m) {
    malformed.push(f);
    continue;
  }
  const num = m[1];
  if (!byNumber.has(num)) byNumber.set(num, []);
  byNumber.get(num).push(f);
}

if (malformed.length) {
  console.error(
    "❌ ADR-NUMBER-001: ADR filenames must be `<NNNN>-<slug>.md` (4-digit number prefix):"
  );
  for (const f of malformed) console.error(`  - ${f}`);
  process.exit(1);
}

// A collision is any number over its allowed count (1, or the grandfathered count).
const violations = [...byNumber.entries()].filter(
  ([num, fs]) => fs.length > (GRANDFATHERED.get(num) ?? 1)
);

if (violations.length) {
  console.error("❌ ADR-NUMBER-001: duplicate ADR numbers (references become ambiguous):");
  for (const [num, fs] of violations) {
    const allowed = GRANDFATHERED.get(num);
    console.error(
      `  ${num}${allowed ? ` (grandfathered for ${allowed}, found ${fs.length})` : ""}:`
    );
    for (const f of fs) console.error(`    - ${f}`);
  }
  const max = [...byNumber.keys()].sort().at(-1);
  console.error(
    `\nFix: renumber your ADR to a unique number greater than the current max (${max}), and update references. Never reuse a number.`
  );
  process.exit(1);
}

const grandfathered = [...GRANDFATHERED.keys()].filter((n) => byNumber.has(n)).length;
console.log(
  `✓ ADR-NUMBER-001: ${files.length - 1} ADRs, no new number collisions` +
    (grandfathered ? ` (${grandfathered} grandfathered pair(s) still present)` : "")
);
