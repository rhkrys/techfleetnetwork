#!/usr/bin/env node
// Guard: every Supabase migration must have a UNIQUE version (the leading
// timestamp before the first underscore). Two migrations sharing a version make
// `supabase db reset` fail with `duplicate key ... schema_migrations_pkey`,
// which breaks migration-smoke + db-test on main AND every open PR — main can no
// longer rebuild from scratch. This happened 2026-08-09 when two PRs both landed
// `20260809160000_*.sql`. migration-smoke catches it too, but only after a ~2-min
// DB spin-up; this is an instant, explicit failure that names the colliding files.
//
// Note: this catches duplicates within the checked-out tree (i.e. on the PR's
// merge-with-main commit). It cannot prevent two still-open PRs from independently
// choosing the same timestamp — that only becomes visible once both are merged,
// which is exactly when this (running on subsequent PRs' merge commits) flags it.

import { readdirSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = "supabase/migrations";

const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));

const byVersion = new Map();
for (const file of files) {
  const version = file.split("_")[0];
  if (!/^\d{14}$/.test(version)) {
    console.error(
      `✗ ${join(MIGRATIONS_DIR, file)} — version prefix "${version}" is not a 14-digit timestamp`
    );
    process.exitCode = 1;
    continue;
  }
  if (!byVersion.has(version)) byVersion.set(version, []);
  byVersion.get(version).push(file);
}

const collisions = [...byVersion.entries()].filter(([, group]) => group.length > 1);

if (collisions.length > 0) {
  console.error("✗ Duplicate migration version(s) — `supabase db reset` will fail:\n");
  for (const [version, group] of collisions) {
    console.error(`  version ${version}:`);
    for (const f of group) console.error(`    - ${join(MIGRATIONS_DIR, f)}`);
  }
  console.error("\nRename one of each colliding pair to a unique, later timestamp.");
  process.exit(1);
}

if (process.exitCode === 1) process.exit(1);
console.log(`OK: ${files.length} migrations, all versions unique.`);
