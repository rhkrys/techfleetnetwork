#!/usr/bin/env node
// Fails CI when a new/edited plpgsql function in supabase/migrations declares
// RETURNS TABLE (...) without `#variable_conflict use_column` at the top of
// the body. Postgres OUT-parameter names shadow column references inside the
// function body, raising `column reference "X" is ambiguous` at call time
// (see get_refactor_kpis incident, 2026-06-04). This guard makes that class
// of bug structurally impossible going forward.
//
// Escape hatch: place `-- @safe-variable-conflict` on the line immediately
// before the function when you have manually proven no shadowing exists.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, basename, relative } from "node:path";

const ROOT = process.cwd();
const MIG_DIR = join(ROOT, "supabase", "migrations");

// Migrations authored on or before this stamp are immutable HISTORY. The
// 2026-06-04 plpgsql_variable_conflict_backfill migration (its stamp == this
// cutoff) retrofitted every historical RETURNS TABLE function at runtime, so the
// original CREATE statements in pre-cutoff files are grandfathered wholesale:
// they cannot be edited (already applied) and were already remediated by the
// backfill. Only migrations authored AFTER the cutoff must ship
// `#variable_conflict use_column` (or the `-- @safe-variable-conflict` hatch when
// shadowing is proven impossible). A post-cutoff migration that re-defines an old
// function is therefore still enforced — exactly where a regression could land.
const BASELINE_CUTOFF = "20260604170800";

function listSqlFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...listSqlFiles(p));
    else if (name.endsWith(".sql")) out.push(p);
  }
  return out;
}

// Per-FUNCTION block detection. Each file is split into function blocks (one
// CREATE FUNCTION up to the next) and inspected in isolation. A single
// mega-regex was fragile: its lazy `[\s\S]*?` gaps backtracked ACROSS function
// boundaries, latching a `LANGUAGE sql` function's name onto a later plpgsql
// function's body (a false positive under the wrong name) while under-counting
// real ones. Block scoping makes cross-function spanning impossible.
const CREATE_RE =
  /(--[ \t]*@safe-variable-conflict[ \t]*\r?\n)?[ \t]*CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([^\s(]+)/gi;
const BODY_RE = /\bAS\s+(\$[A-Za-z_]*\$)([\s\S]*?)\1/; // AS $tag$ <body> $tag$

let violations = 0;
const seen = []; // for human-friendly summary

for (const file of listSqlFiles(MIG_DIR)) {
  const stamp = basename(file).slice(0, 14); // YYYYMMDDHHMMSS prefix (path-sep agnostic)
  if (stamp <= BASELINE_CUTOFF) continue; // immutable, backfilled history — grandfathered
  const sql = readFileSync(file, "utf8");

  // Locate every CREATE [OR REPLACE] FUNCTION and any preceding safe-hatch.
  const starts = [];
  let cm;
  while ((cm = CREATE_RE.exec(sql)) !== null) {
    starts.push({ index: cm.index, safe: !!cm[1], name: cm[2] });
  }

  for (let i = 0; i < starts.length; i++) {
    const s = starts[i];
    const end = i + 1 < starts.length ? starts[i + 1].index : sql.length;
    const block = sql.slice(s.index, end);
    const bodyMatch = BODY_RE.exec(block);
    // The RETURNS / LANGUAGE clauses live in the declaration header, before the
    // body — check there so a body string can't produce a false positive.
    const header = bodyMatch ? block.slice(0, bodyMatch.index) : block;
    // Only plpgsql functions that RETURN TABLE can suffer column shadowing.
    if (!/RETURNS\s+TABLE\s*\(/i.test(header)) continue;
    if (!/\bLANGUAGE\s+plpgsql\b/i.test(header)) continue;
    const body = bodyMatch ? bodyMatch[2] : "";
    seen.push(s.name);
    if (s.safe) continue;
    if (/#variable_conflict\s+use_column/i.test(body)) continue;
    violations++;
    const rel = relative(ROOT, file).replace(/\\/g, "/");
    console.error(
      `✖ ${rel}\n   Function ${s.name} returns TABLE(...) but is missing\n   '#variable_conflict use_column' as the first line of the function body.\n   Fix: insert that line right after AS $$ (or $function$) — see\n   docs/runbooks/plpgsql-variable-conflict.md or get_refactor_kpis.`
    );
  }
}

if (violations > 0) {
  console.error(
    `\n${violations} plpgsql RETURNS TABLE function(s) missing the variable_conflict directive.`
  );
  process.exit(1);
}

console.log(
  `✓ check-plpgsql-variable-conflict: ${seen.length} RETURNS TABLE function definition(s) inspected, all safe.`
);
