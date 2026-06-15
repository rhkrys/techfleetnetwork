#!/usr/bin/env node
/**
 * AUTH-ARCH-CUTOVER-015 — lock the deletion of `src/services/auth.service.ts`.
 *
 * The legacy 625-line mixed-responsibility auth service was deleted on
 * 2026-06-15. Re-introducing it (or any file at that exact path) re-opens
 * every spaghetti bug class the cutover closed. CI fails immediately so
 * the file cannot be revived through a stray `git add`.
 */
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FORBIDDEN = resolve(__dirname, "..", "..", "src", "services", "auth.service.ts");

if (existsSync(FORBIDDEN)) {
  console.error("[check-no-legacy-auth-service] FAILED");
  console.error(`  Found re-introduced legacy file: src/services/auth.service.ts`);
  console.error(`  This file was deleted on 2026-06-15 (AUTH-ARCH-CUTOVER-013..015).`);
  console.error(`  Auth use cases live in src/features/auth/services/*.service.ts`);
  console.error(`  Session lifecycle lives in src/features/auth/services/session.service.ts`);
  process.exit(1);
}

console.log("[check-no-legacy-auth-service] OK — legacy file remains deleted.");
