#!/usr/bin/env node
/**
 * CI guard: every flow under src/features/auth/flows/ MUST return a
 * Result<AuthOk, AuthErr> (discriminated union with `kind`). Bare throws or
 * void returns are not allowed across the service boundary.
 *
 * Heuristic check: each flow file must reference `AuthResult`, `AuthOk`, or
 * `Result<` in its public signature OR import from `../domain/auth-result`.
 * Any flow that doesn't fails CI with a pointer to the contract doc.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const FLOWS_DIR = join(ROOT, "src/features/auth/flows");

let offenders = 0;
let checked = 0;
try {
  for (const name of readdirSync(FLOWS_DIR)) {
    if (!name.endsWith(".flow.ts")) continue;
    checked++;
    const body = readFileSync(join(FLOWS_DIR, name), "utf8");
    const ok =
      body.includes("auth-result") ||
      body.includes("AuthResult") ||
      body.includes("AuthOk") ||
      body.includes("AuthErr") ||
      /Result<\s*[A-Z]/.test(body);
    if (!ok) {
      console.error(`✗ ${name} does not return a Result<AuthOk, AuthErr> shape`);
      offenders++;
    }
  }
} catch (err) {
  console.error("could not read flows dir:", err.message);
  process.exit(1);
}

if (offenders > 0) {
  console.error("\nFix: import AuthResult/AuthOk/AuthErr from src/features/auth/domain/auth-result.ts and return one.");
  process.exit(1);
}
console.log(`✓ auth result contract: ${checked} flow(s) use Result discriminated union`);
