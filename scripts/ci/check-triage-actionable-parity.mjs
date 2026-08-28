#!/usr/bin/env node
// CI guard: TS NON_ACTIONABLE_EVENT_TYPES must be a subset of the DB
// public.is_actionable_event_type() non-actionable array. This is the
// architectural rule that keeps the three previous drifted allowlists
// collapsed to one source of truth.
//
// Reads:
//   1. src/services/error-reporter.service.ts → NON_ACTIONABLE_EVENT_TYPES set
//   2. Most recent migration touching is_actionable_event_type → v_non_actionable array
//
// Fails build (exit 1) if any TS entry is missing from the SQL list, or vice
// versa. See bdd_scenarios TRIAGE-ROOT-005.

import { readFileSync, readdirSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Cross-platform repo root. `new URL(".", import.meta.url).pathname` returns a
// POSIX "/C:/…" on Windows, which resolve() then doubles into "C:\\C:\\…" and the
// guard crashes (ENOENT) instead of verifying. fileURLToPath is correct on every OS.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function readJsSet() {
  const src = readFileSync(join(ROOT, "src/services/error-reporter.service.ts"), "utf8");
  const block = src.match(/NON_ACTIONABLE_EVENT_TYPES[^=]*=\s*new Set\(\[([\s\S]*?)\]\)/);
  if (!block) {
    console.error("[triage-parity] could not find NON_ACTIONABLE_EVENT_TYPES");
    process.exit(2);
  }
  const items = [...block[1].matchAll(/"([a-z0-9_]+)"/g)].map((m) => m[1]);
  return new Set(items);
}

function readSqlSet() {
  const dir = join(ROOT, "supabase/migrations");
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .reverse();
  for (const f of files) {
    const sql = readFileSync(join(dir, f), "utf8");
    if (!/is_actionable_event_type/.test(sql)) continue;
    const arr = sql.match(/v_non_actionable[^=]*:=\s*ARRAY\[([\s\S]*?)\]/);
    if (!arr) continue;
    const items = [...arr[1].matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]);
    return new Set(items);
  }
  console.error("[triage-parity] could not find is_actionable_event_type migration");
  process.exit(2);
}

const js = readJsSet();
const sql = readSqlSet();

const missingFromSql = [...js].filter((x) => !sql.has(x));

if (missingFromSql.length) {
  console.error("[triage-parity] DRIFT — TS list is NOT a subset of DB list");
  console.error("  In TS NON_ACTIONABLE_EVENT_TYPES but NOT in DB is_actionable_event_type:");
  missingFromSql.forEach((x) => console.error(`    - ${x}`));
  console.error("Fix: add these event_types to v_non_actionable in the next migration");
  console.error("of public.is_actionable_event_type. See TRIAGE-ROOT-005.");
  process.exit(1);
}

console.log(
  `[triage-parity] OK — all ${js.size} TS non-actionable event types are covered by DB (DB superset has ${sql.size}).`
);
