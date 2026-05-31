#!/usr/bin/env node
/**
 * CI gate: fail the build if DB-first content architecture drifts back.
 *
 * Checks (all must pass):
 *   1. public/policies/ does not exist (or is empty)
 *   2. public/data/ does not exist (or is empty)
 *   3. No .csv file >50KB committed under src/ or public/ (except public/_fixtures)
 *
 * The DB-presence checks (policy_versions × 6, reference_* × 19) run server-side
 * via the supabase--linter + a smoke test that hits get_current_policy.
 */

import { existsSync, statSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const FORBIDDEN_DIRS = ["public/policies", "public/data"];
const SCAN_DIRS = ["public", "src"];
const ALLOW_PREFIX = ["public/_fixtures"];
const MAX_CSV_BYTES = 50 * 1024;

let failed = 0;

for (const dir of FORBIDDEN_DIRS) {
  const abs = join(ROOT, dir);
  if (existsSync(abs)) {
    const files = readdirSync(abs).filter((f) => {
      try {
        return statSync(join(abs, f)).size > 0;
      } catch {
        return false;
      }
    });
    if (files.length > 0) {
      console.error(`❌ ${dir}/ still contains ${files.length} file(s). Move to private storage bucket.`);
      failed++;
    }
  }
}

function walk(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    const rel = relative(ROOT, full).replaceAll("\\", "/");
    if (ALLOW_PREFIX.some((p) => rel.startsWith(p))) continue;
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") continue;
      walk(full);
    } else if (entry.isFile() && entry.name.endsWith(".csv")) {
      const size = statSync(full).size;
      if (size > MAX_CSV_BYTES) {
        console.error(`❌ ${rel} is ${(size / 1024).toFixed(1)}KB — CSVs >50KB must live in a private storage bucket.`);
        failed++;
      }
    }
  }
}

for (const d of SCAN_DIRS) walk(join(ROOT, d));

if (failed > 0) {
  console.error(`\n${failed} content-architecture violation(s). See mem://tech/data/db-first-content.`);
  process.exit(1);
}

console.log("✅ content architecture clean (no public policies/data, no large CSVs in source).");
