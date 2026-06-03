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

// Scope: only Postgres SQL migrations. TS edge functions use Web Crypto's
// crypto.subtle.digest(), which is a different API.
const files = execSync(
  "git ls-files 'supabase/migrations/*.sql'",
  { encoding: "utf8" },
)
  .split("\n")
  .filter(Boolean);

// Strip SQL string literals and line/block comments so we don't lint inside
// `RAISE EXCEPTION 'function digest(text, ...)'` messages or comments.
function stripNoise(src) {
  // Replace each char with space EXCEPT newlines so line counts stay accurate.
  const blank = (m) => m.replace(/[^\n]/g, " ");
  return src
    .replace(/--[^\n]*/g, blank)
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/\$\$[\s\S]*?\$\$/g, blank)
    .replace(/'(?:''|[^'])*'/g, blank);
}

// Reject newlines in the captured expression so a multi-statement block
// can't trick the regex into reporting the wrong line number.
const VIOLATION_RE = /\bdigest\s*\(\s*([^,)\n]+?)\s*,/gi;
// Catch the additional Issue D (2026-06-02 audit) failure mode: bare `digest(`
// without the `extensions.` schema qualifier. `pgcrypto` lives in `extensions`
// after the security-hardening pass; anon/authenticated callers cannot resolve
// the unqualified name → 42883 floods.
const UNQUALIFIED_RE = /(?<![\w.])digest\s*\(/g;
const OK_CAST_RE = /::\s*(text|bytea)\s*$/i;
const ALLOWLIST_RE = /digest-cast-ok:/;

// Baseline allowlist: already-applied migrations are immutable in Supabase
// (Lovable Cloud rejects edits). New migrations going forward MUST cast.
const BASELINE_ALLOWLIST = new Set([
  "supabase/migrations/20260418032018_604a49df-47b7-4768-8cff-4442e8703b76.sql:59",
]);

let violations = 0;
for (const file of files) {
  const raw = readFileSync(file, "utf8");
  const content = stripNoise(raw);
  const lines = raw.split("\n");
  let m;
  while ((m = VIOLATION_RE.exec(content)) !== null) {
    const expr = m[1].trim();
    // Skip GRANT/CREATE FUNCTION signatures: bare type-name args
    // (`digest(text, text)`) and parameter declarations
    // (`digest(data text, hash text)`).
    if (/^(text|bytea)$/i.test(expr)) continue;
    if (/^[a-z_][a-z0-9_]*\s+(text|bytea)$/i.test(expr)) continue;
    if (OK_CAST_RE.test(expr)) continue;
    // Compute line for context + allowlist check.
    const upTo = content.slice(0, m.index);
    const lineNum = upTo.split("\n").length;
    const prevLine = lines[lineNum - 2] ?? "";
    if (ALLOWLIST_RE.test(prevLine)) continue;
    if (BASELINE_ALLOWLIST.has(`${file}:${lineNum}`)) continue;
    console.error(
      `${file}:${lineNum} digest() first argument is missing an explicit ::text cast → '${expr}'`,
    );
    violations += 1;
  }

  // Pass 2 (Issue D, 2026-06-02 audit) — unqualified `digest(` after extensions
  // schema move. Scoped to migrations dated 2026-06-03 or later so the
  // pre-hardening historical baseline doesn't brick CI; older files keep the
  // ::text-cast rule only. Allowlist via ALLOWLIST_RE or BASELINE_ALLOWLIST.
  const dateMatch = file.match(/migrations\/(\d{8})/);
  const isPostHardening = dateMatch && dateMatch[1] >= "20260603";
  if (!isPostHardening) continue;
  let q;
  while ((q = UNQUALIFIED_RE.exec(content)) !== null) {
    const upTo = content.slice(0, q.index);
    const lineNum = upTo.split("\n").length;
    const prevLine = lines[lineNum - 2] ?? "";
    if (ALLOWLIST_RE.test(prevLine)) continue;
    if (BASELINE_ALLOWLIST.has(`${file}:${lineNum}`)) continue;
    // Skip if it's already qualified inside the same expression
    // (regex lookbehind already excludes `.digest(`, but be defensive).
    const charBefore = content[q.index - 1] ?? "";
    if (charBefore === ".") continue;
    console.error(
      `${file}:${lineNum} bare digest( — must be schema-qualified as extensions.digest( per Issue D.`,
    );
    violations += 1;
  }
}

if (violations > 0) {
  console.error(`\n✗ ${violations} digest() call(s) failed lint — see plan PART B-15 and Issue D.`);
  process.exit(1);
}
console.log("✓ sql-digest: all digest() calls cast explicitly and schema-qualified.");
