#!/usr/bin/env node
/**
 * AUTH-ARCH-CUTOVER-022 — auth screens must talk only to their engine.
 *
 * Screens in `src/features/auth/ui/*.tsx` are presentation-only. They MUST NOT
 * import: the backend client (`@/integrations/supabase/client`), the session
 * port (`@/features/auth/ports/*`), the per-use-case services
 * (`@/features/auth/services/*`), the flows (`@/features/auth/flows/*`), or the
 * rate-limit/captcha/lockout libraries directly. The single allowed dependency
 * direction is screen → engine → flow → service → adapter.
 *
 * Scope: .ts/.tsx under src/features/auth/ui, excluding .d.ts and the __tests__ dir.
 * The harness walk filters only by basename; the sole file under __tests__ is a
 * `.test.tsx`, so excluding `.test.(ts|tsx)` (plus `.d.ts`) reproduces the
 * original directory-level exclusion exactly.
 *
 * Scan/fail-closed/zero-scan/evidence owned by the shared harness (_guard.mjs).
 */
import { runScanGuard } from "./_guard.mjs";

const FORBIDDEN = [
  { needle: "@/integrations/supabase/client", reason: "backend client" },
  { needle: "@/features/auth/ports/", reason: "session port" },
  { needle: "@/features/auth/services/", reason: "use-case service" },
  { needle: "@/features/auth/flows/", reason: "auth flow" },
  { needle: "@/lib/auth-lockout", reason: "lockout library" },
  { needle: "@/lib/auth-captcha", reason: "captcha library" },
  { needle: "@/services/rate-limit.service", reason: "rate-limit service" },
];

runScanGuard({
  name: "check-auth-screen-imports",
  roots: ["src/features/auth/ui"],
  include: /\.tsx?$/,
  exclude: /\.test\.(ts|tsx)$|\.d\.ts$/,
  rule(src) {
    const out = [];
    for (const { needle, reason } of FORBIDDEN) {
      if (src.includes(needle)) {
        out.push({
          text: `forbidden import (${reason}) → ${needle} — move the call into the screen's engine (src/features/auth/engine/*)`,
        });
      }
    }
    return out;
  },
  summary: (n) => `${n} screen file(s)`,
});
