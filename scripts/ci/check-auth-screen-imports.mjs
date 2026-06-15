#!/usr/bin/env node
/**
 * AUTH-ARCH-CUTOVER-022 — auth screens must talk only to their engine.
 *
 * Screens in `src/features/auth/ui/*.tsx` are presentation-only. They MUST NOT
 * import:
 *   - the backend client (`@/integrations/supabase/client`)
 *   - the session port (`@/features/auth/ports/*`)
 *   - the per-use-case services (`@/features/auth/services/*`)
 *   - the flows (`@/features/auth/flows/*`)
 *   - the rate-limit/captcha/lockout libraries directly
 *
 * The single allowed dependency direction is screen → engine → flow → service
 * → adapter. Anything else re-opens the spaghetti the cutover removed.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
const SCREEN_DIR = resolve(REPO_ROOT, "src", "features", "auth", "ui");

const FORBIDDEN = [
  { needle: "@/integrations/supabase/client", reason: "backend client" },
  { needle: "@/features/auth/ports/", reason: "session port" },
  { needle: "@/features/auth/services/", reason: "use-case service" },
  { needle: "@/features/auth/flows/", reason: "auth flow" },
  { needle: "@/lib/auth-lockout", reason: "lockout library" },
  { needle: "@/lib/auth-captcha", reason: "captcha library" },
  { needle: "@/services/rate-limit.service", reason: "rate-limit service" },
];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) {
      if (entry === "__tests__") continue;
      walk(full, out);
    } else if (/\.tsx?$/.test(full) && !full.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

const failures = [];
for (const file of walk(SCREEN_DIR)) {
  const text = readFileSync(file, "utf8");
  for (const { needle, reason } of FORBIDDEN) {
    if (text.includes(needle)) {
      failures.push(`${relative(REPO_ROOT, file)}: forbidden import (${reason}) → ${needle}`);
    }
  }
}

if (failures.length) {
  console.error("\n[check-auth-screen-imports] FAILED — auth screens must only depend on their engine.\n");
  for (const f of failures) console.error("  - " + f);
  console.error("\nFix: move the call into the screen's engine (src/features/auth/engine/*).\n");
  process.exit(1);
}

console.log("[check-auth-screen-imports] OK — auth screens depend only on their engine.");
