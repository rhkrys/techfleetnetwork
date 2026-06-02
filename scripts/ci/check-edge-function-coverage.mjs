#!/usr/bin/env node
// Fails CI if any directory under supabase/functions/ lacks a [functions.<name>]
// block in supabase/config.toml AND isn't on the explicit default allow-list.
//
// Why: a function whose settings drift to platform defaults can silently stop
// being deployed (or get the wrong verify_jwt). This script turns that class
// of incident (e.g. Get Help losing freescout-proxy) into a red build.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const FN_DIR = join(ROOT, "supabase", "functions");
const CONFIG = join(ROOT, "supabase", "config.toml");

// Functions that are intentionally allowed to inherit defaults. Adding to this
// list is a deliberate, reviewed choice — not a workaround.
const KNOWN_DEFAULT_FUNCTIONS = new Set([
  "_shared",
]);

const config = readFileSync(CONFIG, "utf8");
const pinned = new Set(
  [...config.matchAll(/^\s*\[functions\.([a-zA-Z0-9_-]+)\]/gm)].map((m) => m[1]),
);

const dirs = readdirSync(FN_DIR).filter((name) => {
  if (name.startsWith(".")) return false;
  try { return statSync(join(FN_DIR, name)).isDirectory(); } catch { return false; }
});

const missing = dirs.filter(
  (name) => !pinned.has(name) && !KNOWN_DEFAULT_FUNCTIONS.has(name),
);

if (missing.length > 0) {
  console.error(
    "Edge functions without a [functions.<name>] block in supabase/config.toml:\n" +
    missing.map((n) => `  - ${n}`).join("\n") +
    "\n\nAdd an explicit config block (recommended) or add the name to\n" +
    "KNOWN_DEFAULT_FUNCTIONS in scripts/ci/check-edge-function-coverage.mjs\n" +
    "after confirming inheriting defaults is intentional.",
  );
  process.exit(1);
}

console.log(`OK: ${dirs.length - KNOWN_DEFAULT_FUNCTIONS.size} edge functions pinned in config.toml.`);
