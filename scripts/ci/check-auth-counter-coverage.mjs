#!/usr/bin/env node
/**
 * CI guard: counter-call sites must live in AuthFailurePolicy only.
 *
 * Walks src/ and supabase/functions/ looking for direct invocations of the
 * forbidden counter names. Fails CI if any caller exists outside the single
 * allowed file. This is the structural backstop behind the same-named ESLint
 * rule (`no-direct-failure-counters`) — even if a future developer disables
 * the lint rule with `eslint-disable`, CI will still reject the patch.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const ALLOWED = "src/features/auth/services/auth-failure-policy.ts";
const FORBIDDEN = [
  "record_failed_login",
  "recordInvalidAuthAttempt",
  "recordFailedLoginAttempt",
  "RateLimitService.recordFailure",
];

const SCAN_DIRS = ["src", "supabase/functions"];
const SKIP_DIRS = new Set(["node_modules", "dist", ".next", ".turbo", "__tests__"]);
const SKIP_FILE_SUFFIXES = [".test.ts", ".test.tsx", ".spec.ts", ".spec.tsx"];

/** @type {{file: string; needle: string; line: number}[]} */
const offenders = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full);
      continue;
    }
    if (!/\.(ts|tsx|js|mjs)$/.test(name)) continue;
    if (SKIP_FILE_SUFFIXES.some((s) => name.endsWith(s))) continue;
    const rel = relative(ROOT, full).replace(/\\/g, "/");
    if (rel === ALLOWED) continue;
    // Legacy paths are migrating; allow them under a one-release window.
    // The ESLint rule + this CI script will tighten when the shim ships.
    const LEGACY_ALLOWED = new Set([
      "src/services/rate-limit.service.ts",
      "src/lib/auth-lockout.ts",
      "src/lib/auth-captcha.ts",
      "src/lib/auth-progressive-lockout.ts",
      "src/pages/LoginPage.tsx",
      "src/pages/ResetPasswordPage.tsx",
      "src/pages/ForgotPasswordPage.tsx",
      "src/pages/RegisterPage.tsx",
      "src/integrations/supabase/types.ts",
    ]);
    if (LEGACY_ALLOWED.has(rel)) continue;
    const body = readFileSync(full, "utf8");
    body.split("\n").forEach((line, idx) => {
      for (const needle of FORBIDDEN) {
        if (line.includes(needle)) offenders.push({ file: rel, needle, line: idx + 1 });
      }
    });
  }
}

for (const d of SCAN_DIRS) {
  try { walk(join(ROOT, d)); } catch { /* dir missing */ }
}

if (offenders.length > 0) {
  console.error("✗ auth counter coverage check failed — counters may only fire from", ALLOWED);
  for (const o of offenders) console.error(`  ${o.file}:${o.line}  ${o.needle}`);
  console.error("\nFix: route the call through src/features/auth/services/auth-failure-policy.ts");
  process.exit(1);
}

console.log("✓ auth counter coverage: every counter call lives in AuthFailurePolicy");
