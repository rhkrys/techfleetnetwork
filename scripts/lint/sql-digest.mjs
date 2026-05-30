#!/usr/bin/env node
/**
 * sql-digest.mjs — CI lint guarding pgcrypto's `digest(text, text)` signature.
 *
 * Why: Postgres routed `digest($1, 'sha256')` to the wrong overload when the
 * first arg was inferred as `unknown`/`bytea`, producing the historical
 * `function digest(text, unknown) does not exist` floods (20+ in May 2026
 * agent_fix_queue). Forcing an explicit `::text` cast on every digest()
 * call eliminates the ambiguity at the migration site.
 *
 * Lint rule: any `digest(<expr>, ...)` call where <expr> does NOT end in
 * `::text` (or `::bytea`) fails CI.
 *
 * Scope: scans `supabase/migrations/**.sql` and `supabase/functions/**.ts`.
 * Allowlist marker: `-- digest-cast-ok: <reason>` on the preceding line.
 */
import { readFileSync } from "node:fs";
import { globSync } from "node:fs";
import { execSync } from "node:child_process";

const files = execSync(
  "git ls-files 'supabase/migrations/*.sql' 'supabase/functions/**/index.ts'",
  { encoding: "utf8" },
)
  .split("\n")
  .filter(Boolean);

const VIOLATION_RE = /\bdigest\s*\(\s*([^,)]+?)\s*,/gi;
const OK_CAST_RE = /::\s*(text|bytea)\s*$/i;
const ALLOWLIST_RE = /digest-cast-ok:/;

let violations = 0;
for (const file of files) {
  const content = readFileSync(file, "utf8");
  const lines = content.split("\n");
  let m;
  while ((m = VIOLATION_RE.exec(content)) !== null) {
    const expr = m[1].trim();
    if (OK_CAST_RE.test(expr)) continue;
    // Compute line for context + allowlist check.
    const upTo = content.slice(0, m.index);
    const lineNum = upTo.split("\n").length;
    const prevLine = lines[lineNum - 2] ?? "";
    if (ALLOWLIST_RE.test(prevLine)) continue;
    console.error(
      `${file}:${lineNum} digest() first argument is missing an explicit ::text cast → '${expr}'`,
    );
    violations += 1;
  }
}

if (violations > 0) {
  console.error(`\n✗ ${violations} digest() call(s) without ::text cast — see plan PART B-15.`);
  process.exit(1);
}
console.log("✓ sql-digest: all digest() calls cast explicitly.");
