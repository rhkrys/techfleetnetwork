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
import { join } from "node:path";

const ROOT = process.cwd();
const MIG_DIR = join(ROOT, "supabase", "migrations");

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

// Matches:  CREATE [OR REPLACE] FUNCTION ... RETURNS TABLE (...) ... LANGUAGE plpgsql ... AS $tag$ <body> $tag$
const FN_RE =
  /(--\s*@safe-variable-conflict\s*\n)?\s*CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([^\s(]+)[\s\S]*?RETURNS\s+TABLE\s*\([\s\S]*?\)[\s\S]*?LANGUAGE\s+plpgsql[\s\S]*?AS\s+(\$[A-Za-z_]*\$)([\s\S]*?)\3/gi;

let violations = 0;
const seen = []; // for human-friendly summary

for (const file of listSqlFiles(MIG_DIR)) {
  const sql = readFileSync(file, "utf8");
  let m;
  while ((m = FN_RE.exec(sql)) !== null) {
    const safe = !!m[1];
    const fnName = m[2];
    const body = m[4];
    seen.push(fnName);
    if (safe) continue;
    if (/#variable_conflict\s+use_column/i.test(body)) continue;
    violations++;
    const rel = file.replace(ROOT + "/", "");
    console.error(
      `✖ ${rel}\n   Function ${fnName} returns TABLE(...) but is missing\n   '#variable_conflict use_column' as the first line of the function body.\n   Fix: insert that line right after AS $$ (or $function$) — see\n   docs/runbooks/plpgsql-variable-conflict.md or get_refactor_kpis.`,
    );
  }
}

if (violations > 0) {
  console.error(
    `\n${violations} plpgsql RETURNS TABLE function(s) missing the variable_conflict directive.`,
  );
  process.exit(1);
}

console.log(
  `✓ check-plpgsql-variable-conflict: ${seen.length} RETURNS TABLE function definition(s) inspected, all safe.`,
);
