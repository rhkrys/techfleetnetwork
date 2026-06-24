#!/usr/bin/env node
/**
 * AUTH-ARCH-CUTOVER-004 — single Google OAuth entrypoint guard.
 *
 * The ONE allowed Google sign-in caller is `src/components/GoogleSignInButton.tsx`
 * via `supabase.auth.signInWithOAuth({ provider: "google", … })` (native OAuth
 * against the owned Supabase project). The legacy `lovable.auth.signInWithOAuth`
 * adapter is retired — it pointed at Lovable Cloud's managed OAuth and 404s
 * post-migration.
 *
 * Any other file in `src/` or `supabase/functions/` that calls
 * `supabase.auth.signInWithOAuth(... provider: "google" ...)` OR
 * `lovable.auth.signInWithOAuth("google" ...)` fails CI. This blocks the
 * duplicate-path class of bug (e.g. the deleted
 * `src/features/auth/flows/sign-in-google.flow.ts`) from coming back.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const ALLOWED = new Set([
  "src/components/GoogleSignInButton.tsx",
  "src/integrations/lovable/index.ts",
  "scripts/ci/check-no-direct-google-oauth.mjs",
]);

const SCAN_DIRS = ["src", "supabase/functions"];
const RE_SUPABASE_GOOGLE = /signInWithOAuth\s*\(\s*\{[^}]*provider\s*:\s*["']google["']/s;
const RE_LOVABLE_GOOGLE = /lovable\.auth\.signInWithOAuth\s*\(\s*["']google["']/;

const offenders = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) { walk(full); continue; }
    if (!/\.(ts|tsx|mjs|js)$/.test(name)) continue;
    if (name.endsWith(".test.ts") || name.endsWith(".test.tsx")) continue;
    const rel = relative(ROOT, full).replace(/\\/g, "/");
    if (ALLOWED.has(rel)) continue;
    const body = readFileSync(full, "utf8");
    if (RE_LOVABLE_GOOGLE.test(body) || RE_SUPABASE_GOOGLE.test(body)) {
      offenders.push(rel);
    }
  }
}

for (const d of SCAN_DIRS) {
  try { walk(join(ROOT, d)); } catch { /* dir missing — fine */ }
}

if (offenders.length > 0) {
  console.error("✗ Google OAuth must have exactly one entrypoint (GoogleSignInButton + lovable.auth).");
  console.error("  Offenders:");
  for (const o of offenders) console.error(`   - ${o}`);
  console.error("\nFix: route Google sign-in through `<GoogleSignInButton/>`. Do NOT add a second path.");
  process.exit(1);
}

console.log("✓ Google OAuth single-entrypoint guard passed.");
