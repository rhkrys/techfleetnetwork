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
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
const SRC_ROOT = resolve(REPO_ROOT, "src");
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

const escaped = LEGACY_MODULES.map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
const RX = new RegExp(`from ["'](?:${escaped.join("|")})["']`);

const EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) walk(full, out);
    else if (EXTS.has(full.slice(full.lastIndexOf("."))) && !full.endsWith(".d.ts")) out.push(full);
  }
  return out;
}

function scan() {
  const hits = [];
  for (const file of walk(SRC_ROOT)) {
    const text = readFileSync(file, "utf8");
    if (RX.test(text)) hits.push(relative(REPO_ROOT, file).replace(/\\/g, "/"));
  }
  return hits.sort();
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
