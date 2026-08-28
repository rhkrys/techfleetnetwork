#!/usr/bin/env node
/**
 * CI guard: counter-call sites must live in AuthFailurePolicy only.
 *
 * Fails CI if any of the forbidden counter names is invoked outside the auth
 * failure-policy funnel (the two policy files + the ports/ adapter layer) or the
 * one-release LEGACY_ALLOWED window. Structural backstop behind the ESLint rule
 * `no-direct-failure-counters` (survives an `eslint-disable`).
 *
 * Scan/fail-closed/zero-scan/evidence owned by the shared harness (_guard.mjs).
 */
import { runScanGuard } from "./_guard.mjs";

// Counter calls are sanctioned ONLY inside the auth feature's failure-policy
// funnel + its adapter (ports) layer. Mirrors the ESLint rule's exemptions.
const ALLOWED = new Set([
  "src/features/auth/services/auth-failure-policy.ts",
  "src/features/auth/engine/failure-policy.ts",
]);
const ALLOWED_DIR_PREFIX = "src/features/auth/ports/";
// Legacy paths are migrating; allowed under a one-release window.
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
const FORBIDDEN = [
  "record_failed_login",
  "recordInvalidAuthAttempt",
  "recordFailedLoginAttempt",
  "RateLimitService.recordFailure",
];

runScanGuard({
  name: "check-auth-counter-coverage",
  roots: ["src", "supabase/functions"],
  include: /\.(ts|tsx|js|mjs)$/,
  exclude: /\.(test|spec)\.(ts|tsx)$/,
  rule(src, rel) {
    if (ALLOWED.has(rel) || rel.startsWith(ALLOWED_DIR_PREFIX) || LEGACY_ALLOWED.has(rel)) {
      return [];
    }
    const out = [];
    src.split("\n").forEach((line, idx) => {
      for (const needle of FORBIDDEN) {
        if (line.includes(needle)) out.push({ line: idx + 1, text: needle });
      }
    });
    return out;
  },
});
