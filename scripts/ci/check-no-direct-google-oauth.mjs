#!/usr/bin/env node
/**
 * AUTH-ARCH-CUTOVER-004 — single Google OAuth entrypoint guard.
 *
 * The ONE allowed Google sign-in caller is src/components/GoogleSignInButton.tsx
 * via supabase.auth.signInWithOAuth({ provider: "google", … }). Any other file in
 * src/ or supabase/functions/ that calls supabase.auth.signInWithOAuth(... google)
 * or the retired lovable.auth.signInWithOAuth("google" ...) fails CI — this blocks
 * the duplicate-path class of bug from coming back.
 *
 * Scan/fail-closed/zero-scan/evidence owned by the shared harness (_guard.mjs).
 */
import { runScanGuard } from "./_guard.mjs";

const ALLOWED = new Set([
  "src/components/GoogleSignInButton.tsx",
  "src/integrations/lovable/index.ts",
  "scripts/ci/check-no-direct-google-oauth.mjs",
]);
const RE_SUPABASE_GOOGLE = /signInWithOAuth\s*\(\s*\{[^}]*provider\s*:\s*["']google["']/s;
const RE_LOVABLE_GOOGLE = /lovable\.auth\.signInWithOAuth\s*\(\s*["']google["']/;

runScanGuard({
  name: "check-no-direct-google-oauth",
  roots: ["src", "supabase/functions"],
  include: /\.(ts|tsx|mjs|js)$/,
  exclude: /\.test\.(ts|tsx)$/,
  rule(src, rel) {
    if (ALLOWED.has(rel)) return [];
    if (RE_LOVABLE_GOOGLE.test(src) || RE_SUPABASE_GOOGLE.test(src)) {
      return [
        {
          text: "calls signInWithOAuth({ provider: 'google' }) outside GoogleSignInButton — route Google sign-in through <GoogleSignInButton/>; do NOT add a second path.",
        },
      ];
    }
    return [];
  },
});
