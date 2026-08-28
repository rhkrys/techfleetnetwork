#!/usr/bin/env node
/**
 * CI guard: forbid `.rpc(...).catch(...)` and `safeRpc(...).catch(...)` in
 * every TypeScript file across `src/**` and `supabase/functions/**`.
 *
 * Why: the Supabase JS `PostgrestFilterBuilder` returned by `.rpc()` is
 * awaitable but NOT a Promise — calling `.catch()` on it throws
 * "supabase.rpc(...).catch is not a function" at runtime (root cause of the
 * 2026-06-05 outage: 18 `email_failed` rows in `audit_log`).
 *
 * Mirrors the ESLint rule `triage-permanent/no-rpc-then-catch` but also covers
 * Deno edge functions. Escape hatch: `// rpc-catch-ok: <reason>` on the line.
 *
 * Scan/fail-closed/zero-scan/evidence owned by the shared harness (_guard.mjs).
 * (node_modules/dist do not exist under the scan roots, so the harness's
 * basename walk yields the same set; test files ARE in scope, so `exclude`
 * is set to never match.)
 */
import { runScanGuard } from "./_guard.mjs";

const PATTERN = /(\.rpc\s*\([^)]*\)|\bsafeRpc\s*\([^)]*\))\s*\.catch\s*\(/g;

runScanGuard({
  name: "check-no-rpc-catch",
  roots: ["src", "supabase/functions"],
  include: /\.(ts|tsx|mts|cts)$/,
  exclude: /(?!)/, // never match — test files are in scope for this guard
  rule(src) {
    const out = [];
    const lines = src.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      PATTERN.lastIndex = 0;
      if (!PATTERN.test(line)) continue;
      if (/rpc-catch-ok:/.test(line)) continue;
      out.push({ line: i + 1, text: line.trim() });
    }
    return out;
  },
});
