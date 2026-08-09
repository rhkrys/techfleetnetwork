#!/usr/bin/env node
/**
 * MIGRATION-VERSION-001 guard: no two files in supabase/migrations/ may share a
 * version prefix (the `<version>` in `<version>_<name>.sql`, i.e. the numeric part
 * before the first underscore).
 *
 * Why: that version is the PRIMARY KEY of supabase_migrations.schema_migrations.
 * Two migrations with the same version make `supabase db reset` / `db push` abort
 * with `duplicate key value violates unique constraint "schema_migrations_pkey"`,
 * which fails the BLOCKING migration-smoke gate for everyone. This has recurred
 * whenever parallel PRs each pick a bare date-based timestamp: each PR is CI-green
 * against a base that lacks the other's migration, then they collide on merge.
 *
 * On a `pull_request` run, CI checks out the PR *merged into base*, so this scan
 * sees the PR's migration alongside base's and catches a cross-PR collision at PR
 * time (before merge) with a clear message — provided the PR is tested against the
 * latest base ("require branches to be up to date before merging").
 *
 * Fix when it fires: renumber one file to a unique version greater than the current
 * max — take `max(all existing versions) + an increment`, never reuse a date.
 */
import { readdirSync } from "node:fs";

const DIR = "supabase/migrations";

let files;
try {
  files = readdirSync(DIR).filter((f) => f.endsWith(".sql"));
} catch (e) {
  console.error(`❌ MIGRATION-VERSION-001: cannot read ${DIR}: ${e.message}`);
  process.exit(1);
}

const byVersion = new Map();
const malformed = [];

for (const f of files) {
  const m = f.match(/^([0-9]+)_/);
  if (!m) {
    malformed.push(f);
    continue;
  }
  const version = m[1];
  if (!byVersion.has(version)) byVersion.set(version, []);
  byVersion.get(version).push(f);
}

const dups = [...byVersion.entries()].filter(([, fs]) => fs.length > 1);

if (malformed.length) {
  console.error(
    "❌ MIGRATION-VERSION-001: migration filenames must be `<version>_<name>.sql` (numeric version prefix):"
  );
  for (const f of malformed) console.error(`  - ${f}`);
  process.exit(1);
}

if (dups.length) {
  console.error(
    "❌ MIGRATION-VERSION-001: duplicate migration version prefixes (schema_migrations_pkey will collide, breaking migration-smoke):"
  );
  for (const [version, fs] of dups) {
    console.error(`  ${version}:`);
    for (const f of fs) console.error(`    - ${f}`);
  }
  const max = [...byVersion.keys()].sort().at(-1);
  console.error(
    `\nFix: renumber one file to a unique version greater than the current max (${max}). Never reuse a bare date.`
  );
  process.exit(1);
}

console.log(`✓ MIGRATION-VERSION-001: ${files.length} migrations, all version prefixes unique`);
