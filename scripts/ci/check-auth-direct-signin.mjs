#!/usr/bin/env node
/**
 * AUTH-DIRECT-SIGNIN guard.
 *
 * Locks the "one password-sign-in owner" invariant:
 *   - `src/features/auth/services/sign-in.service.ts` is the ONLY non-legacy
 *     module that may call `supabase.auth.signInWithPassword` for the login
 *     form. It must NEVER touch the edge-token handoff or setSession.
 *   - The active login chain (SignInScreen → useSignInEngine → flow → service)
 *     must NOT call `login-with-captcha`, `setSessionSafe`,
 *     `supabase.auth.setSession`, or the deleted
 *     `AuthService.signInWithPassword`.
 *   - Outside the engine layer, no one may touch raw login lockout / captcha
 *     storage keys.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();

const FORBIDDEN_IN_ACTIVE_PATH = [
  "login-with-captcha",
  "setSessionSafe",
  "supabase.auth.setSession",
  "AuthService.signInWithPassword",
];

const checks = [
  { file: "src/features/auth/services/sign-in.service.ts", forbidden: FORBIDDEN_IN_ACTIVE_PATH },
  { file: "src/features/auth/flows/sign-in-password.flow.ts", forbidden: FORBIDDEN_IN_ACTIVE_PATH },
  { file: "src/features/auth/engine/use-sign-in-engine.ts", forbidden: FORBIDDEN_IN_ACTIVE_PATH },
  { file: "src/features/auth/ui/SignInScreen.tsx", forbidden: FORBIDDEN_IN_ACTIVE_PATH },
  // The legacy AuthService must NOT regrow a signInWithPassword method.
  { file: "src/services/auth.service.ts", forbidden: ["async signInWithPassword(", "signInWithPassword:"] },
];

const failures = [];

for (const check of checks) {
  let text;
  try {
    text = readFileSync(resolve(root, check.file), "utf8");
  } catch {
    failures.push(`${check.file}: required guarded file is missing`);
    continue;
  }
  for (const token of check.forbidden) {
    if (text.includes(token)) failures.push(`${check.file}: forbidden token '${token}'`);
  }
}

if (failures.length) {
  console.error("\nAuth direct-signin guard FAILED:\n");
  for (const failure of failures) console.error(`  - ${failure}`);
  console.error("\nThe active /login path must call the auth SDK through `signInWithPasswordService`.");
  console.error("Do not restore login-with-captcha, setSession, setSessionSafe, or AuthService.signInWithPassword.\n");
  process.exit(1);
}

console.log("Auth direct-signin guard passed (one password-sign-in owner).");
