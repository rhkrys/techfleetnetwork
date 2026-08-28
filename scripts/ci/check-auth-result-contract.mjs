#!/usr/bin/env node
/**
 * CI guard: every flow under src/features/auth/flows/ MUST return a
 * Result<AuthOk, AuthErr> (discriminated union with `kind`). Bare throws or
 * void returns are not allowed across the service boundary.
 *
 * Heuristic: each *.flow.ts file must reference `AuthResult`, `AuthOk`,
 * `AuthErr`, `Result<Caps…>`, or import from `../domain/auth-result`.
 *
 * Scan/fail-closed/zero-scan/evidence owned by the shared harness (_guard.mjs).
 */
import { runScanGuard } from "./_guard.mjs";

runScanGuard({
  name: "check-auth-result-contract",
  roots: ["src/features/auth/flows"],
  include: /\.flow\.ts$/,
  exclude: /\.test\.ts$/,
  rule(src, rel) {
    const ok =
      src.includes("auth-result") ||
      src.includes("AuthResult") ||
      src.includes("AuthOk") ||
      src.includes("AuthErr") ||
      /Result<\s*[A-Z]/.test(src);
    if (ok) return [];
    return [
      {
        text: `${rel.split("/").pop()} does not return a Result<AuthOk, AuthErr> shape — import AuthResult/AuthOk/AuthErr from src/features/auth/domain/auth-result.ts and return one.`,
      },
    ];
  },
  summary: (n) => `${n} flow(s)`,
});
