#!/usr/bin/env node
/**
 * CI guard: forbid `.rpc(...).catch(...)` and `safeRpc(...).catch(...)` in
 * every TypeScript file across `src/**` and `supabase/functions/**`.
 *
 * Why: the Supabase JS `PostgrestFilterBuilder` returned by `.rpc()` is
 * awaitable but NOT a Promise — calling `.catch()` on it throws
 * "supabase.rpc(...).catch is not a function" at runtime. This was the root
 * cause of the 2026-06-05 outage that produced 18 `email_failed` rows in
 * `audit_log` (recovery + signup + triage-digest lanes).
 *
 * This script mirrors the ESLint rule `triage-permanent/no-rpc-then-catch`
 * but also covers Deno edge functions (which ESLint does not lint in CI).
 *
 * Escape hatch: `// rpc-catch-ok: <reason>` on the same line.
 */
import { promises as fs } from "node:fs";
import path from "node:path";

const ROOTS = ["src", "supabase/functions"];
const PATTERN = /(\.rpc\s*\([^)]*\)|\bsafeRpc\s*\([^)]*\))\s*\.catch\s*\(/g;

async function walk(dir, out) {
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); }
  catch { return; }
  for (const e of entries) {
    if (e.name === "node_modules" || e.name === "dist") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walk(p, out);
    else if (/\.(ts|tsx|mts|cts)$/.test(e.name)) out.push(p);
  }
}

const files = [];
for (const r of ROOTS) await walk(r, files);

const offenders = [];
for (const f of files) {
  const txt = await fs.readFile(f, "utf8");
  const lines = txt.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    PATTERN.lastIndex = 0;
    if (!PATTERN.test(line)) continue;
    if (/rpc-catch-ok:/.test(line)) continue;
    offenders.push(`${f}:${i + 1}: ${line.trim()}`);
  }
}

if (offenders.length) {
  console.error("\n❌ no-rpc-catch CI guard failed.\n");
  console.error("`.rpc(...).catch(...)` throws at runtime — wrap in `try { await ... } catch {}` or check `{ error }`.\n");
  for (const o of offenders) console.error("  " + o);
  console.error("");
  process.exit(1);
}

console.log(`✅ no-rpc-catch: scanned ${files.length} files, 0 offenders.`);
