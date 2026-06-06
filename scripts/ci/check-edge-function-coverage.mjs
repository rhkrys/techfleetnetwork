#!/usr/bin/env node
// Zero-tolerance edge-function pin guard.
//
// EVERY directory under supabase/functions/ (except _shared) MUST have an
// explicit [functions.<name>] block in supabase/config.toml. No allow-list,
// no baseline, no escape hatch.
//
// History: the previous BASELINE_DEFAULT_FUNCTIONS allow-list grew over months
// into a parking lot of ~21 names, including auth-critical functions like
// update-password-confirmed. The platform tightened deploy behavior and every
// unpinned function silently stopped shipping, surfacing as the
// "We couldn't update your password" outage (2026-06-05). Removing the
// allow-list makes that failure mode structurally impossible.
//
// Run with --fix to auto-append missing blocks (verify_jwt = true default).
import { readdirSync, readFileSync, writeFileSync, statSync, appendFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const FN_DIR = join(ROOT, "supabase", "functions");
const CONFIG = join(ROOT, "supabase", "config.toml");
const SRC_DIR = join(ROOT, "src");
const FIX = process.argv.includes("--fix");

const config = readFileSync(CONFIG, "utf8");
const pinned = new Set(
  [...config.matchAll(/^\s*\[functions\.([a-zA-Z0-9_-]+)\]/gm)].map((m) => m[1]),
);

const dirs = readdirSync(FN_DIR).filter((name) => {
  if (name === "_shared" || name.startsWith(".")) return false;
  try { return statSync(join(FN_DIR, name)).isDirectory(); } catch { return false; }
});

const missing = dirs.filter((name) => !pinned.has(name));

if (missing.length > 0 && FIX) {
  const blocks = missing.map((n) =>
    `  [functions.${n}]\n    verify_jwt = true\n`
  ).join("");
  appendFileSync(CONFIG, blocks);
  console.log(`Pinned ${missing.length} function(s) with verify_jwt = true:\n` +
    missing.map((n) => `  + ${n}`).join("\n"));
  process.exit(0);
}

let failed = false;
if (missing.length > 0) {
  console.error(
    "Edge functions without a [functions.<name>] block in supabase/config.toml:\n" +
    missing.map((n) => `  - ${n}`).join("\n") +
    "\n\nEvery edge function dir MUST be pinned. Run:\n" +
    "  node scripts/ci/check-edge-function-coverage.mjs --fix\n" +
    "to auto-pin with verify_jwt = true, then adjust for webhooks/cron.\n",
  );
  failed = true;
}

// Defense-in-depth: scan src/ invocations and require each to be pinned.
function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) {
      if (entry === "node_modules" || entry === "dist" || entry.startsWith(".")) continue;
      walk(p, files);
    } else if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry)) {
      files.push(p);
    }
  }
  return files;
}

const invokeRe = /\.functions\.invoke\s*\(\s*["'`]([a-zA-Z0-9_-]+)["'`]/g;
const invoked = new Set();
try {
  for (const f of walk(SRC_DIR)) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(invokeRe)) invoked.add(m[1]);
  }
} catch { /* no src/ */ }

const invokedMissing = [...invoked].filter(
  (name) => !pinned.has(name) && dirs.includes(name),
);
if (invokedMissing.length > 0) {
  console.error(
    "\nFunctions invoked from src/ but NOT pinned:\n" +
    invokedMissing.map((n) => `  - ${n}`).join("\n") + "\n",
  );
  failed = true;
}

if (failed) process.exit(1);

// Emit the manifest as a side-effect — single source of truth consumed by
// audited-invoke and the deploy-smoke cron.
const manifest = {
  generated_at: new Date().toISOString(),
  functions: dirs.sort().map((name) => {
    const block = config.match(
      new RegExp(`\\[functions\\.${name}\\]\\s*\\n\\s*verify_jwt\\s*=\\s*(true|false)`, "i")
    );
    const verify_jwt = block ? block[1] === "true" : true;
    return { name, verify_jwt };
  }),
};
const manifestJson = JSON.stringify(manifest, null, 2) + "\n";
writeFileSync(join(ROOT, "supabase", "functions.manifest.json"), manifestJson);
// Mirror into the smoke function dir so it can import the manifest at runtime
// (edge runtime cannot import from parent dirs).
try {
  writeFileSync(
    join(FN_DIR, "edge-deploy-smoke", "_manifest.json"),
    manifestJson,
  );
} catch { /* dir may not exist yet on first run */ }

console.log(`OK: ${dirs.length} edge functions all pinned; manifest written.`);
