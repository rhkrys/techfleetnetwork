#!/usr/bin/env node
/**
 * Auth-rebuild Ship 5 guard.
 *
 * Snapshot-locks the set of files allowed to import the legacy auth modules
 * scheduled for deletion. New importers fail CI immediately — every code path
 * that needs auth must go through `src/features/auth/engine/*` or the
 * `sessionPort` at `src/features/auth/ports/session.port.ts`.
 *
 * The allowlist shrinks as engines are rewritten to consume ports/adapters.
 * To remove an entry: delete the file (or remove the legacy import) and run
 *   node scripts/ci/check-legacy-auth-importers.mjs --update
 * locally to refresh the snapshot. CI only verifies; it never mutates.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_PATH = resolve(__dirname, "legacy-auth-importers.snapshot.json");

const LEGACY_MODULES = [
  "@/services/auth.service",
  "@/lib/auth-lockout",
  "@/lib/auth-captcha",
  "@/lib/auth-captcha-telemetry",
  "@/lib/auth-error-classifier",
  "@/components/auth/TurnstileChallenge",
  "@/components/auth/AuthCaptchaField",
  "@/features/auth/flows/sign-in-password.flow",
  "@/features/auth/state/use-auth-machine",
];

const pattern = LEGACY_MODULES.map((m) => `from ['"]${m.replace(/\./g, "\\.")}['"]`).join("|");

function scan() {
  try {
    const out = execSync(`rg -l "${pattern}" src 2>/dev/null || true`, { encoding: "utf8" });
    return out.split("\n").filter(Boolean).sort();
  } catch {
    return [];
  }
}

const current = scan();

if (process.argv.includes("--update")) {
  writeFileSync(SNAPSHOT_PATH, JSON.stringify({ allowed: current }, null, 2) + "\n");
  console.log(`Snapshot refreshed (${current.length} files).`);
  process.exit(0);
}

let snapshot;
try {
  snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8")).allowed ?? [];
} catch {
  console.error(`Missing snapshot at ${SNAPSHOT_PATH}. Run with --update locally.`);
  process.exit(1);
}

const allowed = new Set(snapshot);
const newViolations = current.filter((f) => !allowed.has(f));
const removed = snapshot.filter((f) => !current.includes(f));

if (newViolations.length > 0) {
  console.error("\n❌ New importer(s) of legacy auth modules detected:\n");
  for (const f of newViolations) console.error(`   - ${f}`);
  console.error("\nLegacy modules (scheduled for deletion in Ship 5 of the auth rebuild):");
  for (const m of LEGACY_MODULES) console.error(`   - ${m}`);
  console.error("\nFix: route through `@/features/auth/engine/*` or `sessionPort`.");
  console.error("If this is intentional and the new importer is itself slated for deletion,");
  console.error("run `node scripts/ci/check-legacy-auth-importers.mjs --update` and commit.\n");
  process.exit(1);
}

if (removed.length > 0) {
  console.log(`✅ Snapshot can shrink by ${removed.length} file(s) — run --update to refresh:`);
  for (const f of removed) console.log(`   - ${f}`);
}

console.log(`✅ Legacy auth importers within allowlist (${current.length} files).`);
