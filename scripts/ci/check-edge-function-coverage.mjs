#!/usr/bin/env node
// Zero-tolerance edge-function pin guard + manifest generator.
//
// Rules:
//   1. EVERY dir under supabase/functions/ (except _shared) MUST have a
//      [functions.<name>] block in supabase/config.toml.
//   2. The first ~10 lines of every index.ts SHOULD declare intent via a
//      magic comment: `// @edge-auth required`, `// @edge-public`, or
//      `// @edge-cron`. Missing comments are warned (not failed) so we can
//      backfill incrementally; contradictions with config.toml verify_jwt
//      ARE failures.
//   3. Every function invoked from src/ must be pinned.
//   4. The manifest at supabase/functions.manifest.json + the runtime copy
//      at supabase/functions/edge-deploy-smoke/_manifest.json are kept in
//      sync with config.toml (kind = auth | public | cron).
//
// Run with --fix to auto-append missing [functions.<name>] blocks.
import { readdirSync, readFileSync, writeFileSync, statSync, appendFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const FN_DIR = join(ROOT, "supabase", "functions");
const CONFIG = join(ROOT, "supabase", "config.toml");
const SRC_DIR = join(ROOT, "src");
const FIX = process.argv.includes("--fix");
const STRICT = process.argv.includes("--strict");

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

// Magic-comment contract. We classify each function as auth | public | cron.
// Source order: explicit `// @edge-*` comment > verify_jwt heuristic.
function readKind(name) {
  const idx = join(FN_DIR, name, "index.ts");
  if (!existsSync(idx)) return { kind: null, hasComment: false, critical: false };
  const head = readFileSync(idx, "utf8").split("\n").slice(0, 15).join("\n");
  if (/\/\/\s*@edge-cron\b/.test(head)) return { kind: "cron", hasComment: true, critical: false };
  if (/\/\/\s*@edge-public\b/.test(head)) return { kind: "public", hasComment: true, critical: false };
  if (/\/\/\s*@edge-auth\b/.test(head)) {
    const critical = /@edge-auth\s+required\b/.test(head);
    return { kind: "auth", hasComment: true, critical };
  }
  return { kind: null, hasComment: false, critical: false };
}

// Single source of truth for AUTH-CRITICAL functions (404 strands real users
// mid-flow → page admins immediately via Triage Critical Push). Until every
// function carries `// @edge-auth required`, this list backstops the comment
// scan. To add a new critical function, add `// @edge-auth required` to its
// index.ts — the generator will pick it up and you can remove it from here.
const CRITICAL_FALLBACK = new Set([
  "update-password-confirmed",
  "login-with-captcha",
  "send-magic-link",
  "verify-turnstile",
  "validate-email-domain",
  "resend-signup-confirmations",
  "sign-out-all-devices",
  "revoke-user-sessions",
  "delete-account",
  "admin-purge-auth-user",
  "admin-sign-out-all-users",
  "record-consent",
  "record-policy-acknowledgment",
]);

const contradictions = [];
const undeclared = [];
const functionsManifest = dirs.sort().map((name) => {
  const block = config.match(
    new RegExp(`\\[functions\\.${name}\\]\\s*\\n\\s*verify_jwt\\s*=\\s*(true|false)`, "i")
  );
  const verify_jwt = block ? block[1] === "true" : true;
  const { kind, hasComment } = readKind(name);
  // Contradiction: @edge-auth but verify_jwt=false, or @edge-public/cron but verify_jwt=true.
  if (hasComment) {
    if (kind === "auth" && !verify_jwt) contradictions.push(`${name}: @edge-auth but verify_jwt=false`);
    if ((kind === "public" || kind === "cron") && verify_jwt) {
      contradictions.push(`${name}: @edge-${kind} but verify_jwt=true`);
    }
  } else {
    undeclared.push(name);
  }
  const resolvedKind = kind ?? (verify_jwt ? "auth" : "public");
  return { name, verify_jwt, kind: resolvedKind, declared: hasComment };
});

if (contradictions.length > 0) {
  console.error("\nMagic-comment / verify_jwt contradictions:\n" +
    contradictions.map((c) => `  - ${c}`).join("\n") + "\n");
  failed = true;
}
if (undeclared.length > 0) {
  const msg = `\n${undeclared.length} function(s) missing // @edge-auth|public|cron comment in first 15 lines of index.ts:\n` +
    undeclared.slice(0, 10).map((n) => `  - ${n}`).join("\n") +
    (undeclared.length > 10 ? `\n  … and ${undeclared.length - 10} more` : "") + "\n";
  if (STRICT) { console.error(msg); failed = true; } else { console.warn(msg); }
}

if (failed) process.exit(1);

const manifest = {
  generated_at: new Date().toISOString(),
  functions: functionsManifest,
};
const manifestJson = JSON.stringify(manifest, null, 2) + "\n";
writeFileSync(join(ROOT, "supabase", "functions.manifest.json"), manifestJson);
try {
  writeFileSync(
    join(FN_DIR, "edge-deploy-smoke", "_manifest.json"),
    manifestJson,
  );
} catch { /* dir may not exist yet on first run */ }

console.log(`OK: ${dirs.length} edge functions all pinned; manifest written (${undeclared.length} undeclared kind).`);
