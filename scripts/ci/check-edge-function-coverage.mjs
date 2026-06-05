#!/usr/bin/env node
// Fails CI if any directory under supabase/functions/ lacks a [functions.<name>]
// block in supabase/config.toml AND isn't on the explicit baseline allow-list.
//
// Two checks:
//   1. Every supabase/functions/<name>/ dir must be pinned OR on the baseline.
//   2. AUTH-PIN-001 (2026-06-05): every function invoked from src/ via
//      supabase.functions.invoke("<name>") MUST be pinned — no baseline escape.
//      Unpinned client-invoked functions silently 404 in prod (caused the
//      "update-password-confirmed" outage where users saw a generic
//      "We couldn't update your password" error with no audit trail).
//
// Why: a function whose settings drift to platform defaults can silently stop
// being deployed (or get the wrong verify_jwt). This script turns that class
// of incident (Get Help / freescout-proxy, update-password-confirmed) into
// a red build.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const FN_DIR = join(ROOT, "supabase", "functions");
const CONFIG = join(ROOT, "supabase", "config.toml");
const SRC_DIR = join(ROOT, "src");

// Adding to this list is a deliberate, reviewed choice — not a workaround.
// Prefer pinning the function in supabase/config.toml. Auth, signup, login,
// password-reset, and account-management functions MUST NEVER appear here.
const BASELINE_DEFAULT_FUNCTIONS = new Set([
  "_shared",
  "airtable-diag",
  "backfill-discord-usernames", "bump-email-warmup",
  "discord-project-update", "dsar-submit", "email-pipeline-health",
  "fetch-class-certifications", "fetch-project-certifications",
  "fill-content-gaps", "firecrawl-search", "fleety-bulk-draft-playbooks",
  "framework-csv-fetch", "geo-hint", "get-community-events",
  "grant-observer-role", "gumroad-backfill", "ingest-reference-csv",
  "manage-discord-roles", "mark-interview-scheduled",
  "notify-applicant-status", "notify-class-published", "prewarm-ugc-worker",
  "process-notification-fanout", "promote-to-teacher", "quest-nudge",
  "rate-limit",
  "refresh-community-events", "refresh-email-health", "repair-discord-username",
  "replay-dlq-emails", "revoke-recording-consent",
  "revoke-teacher-role", "save-form-draft",
  "scrape-figma-workshops", "screen-sanctions", "seed-content",
  "send-announcement-email", "send-community-agreement-trigger",
  "send-project-blast", "send-push-notification",
  "submit-dispute", "support-monthly-report",
  "support-provisioning-retry", "sync-airtable", "sync-airtable-network-stats",
  "translate-bundle", "translate-strings",
  "write-exploration-cache",
]);

// Functions in this set are auth-critical: never allow them on the baseline,
// always require an explicit pin block. If a name in this set is missing
// from config.toml the build fails even if it's on the baseline (defense
// in depth against accidental re-entry).
const AUTH_CRITICAL = new Set([
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

const config = readFileSync(CONFIG, "utf8");
const pinned = new Set(
  [...config.matchAll(/^\s*\[functions\.([a-zA-Z0-9_-]+)\]/gm)].map((m) => m[1]),
);

const dirs = readdirSync(FN_DIR).filter((name) => {
  if (name.startsWith(".")) return false;
  try { return statSync(join(FN_DIR, name)).isDirectory(); } catch { return false; }
});

// --- Check 1: every function dir is pinned or on the baseline ---
const missing = dirs.filter(
  (name) => !pinned.has(name) && !BASELINE_DEFAULT_FUNCTIONS.has(name),
);

// --- Check 2: every auth-critical function must be explicitly pinned ---
const authMissing = [...AUTH_CRITICAL].filter((name) => !pinned.has(name));

// --- Check 3: scan src/ for supabase.functions.invoke("<name>") calls and
// require each to be pinned (no baseline escape) ---
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

let failed = false;
if (missing.length > 0) {
  console.error(
    "Edge functions without a [functions.<name>] block in supabase/config.toml:\n" +
    missing.map((n) => `  - ${n}`).join("\n") +
    "\n\nPin each function with an explicit config block in supabase/config.toml,\n" +
    "e.g.\n  [functions.my-fn]\n    verify_jwt = true\n",
  );
  failed = true;
}
if (authMissing.length > 0) {
  console.error(
    "\nAUTH-CRITICAL functions missing explicit [functions.<name>] pin:\n" +
    authMissing.map((n) => `  - ${n}`).join("\n") +
    "\n\nAuth/signup/login/reset functions can never inherit platform defaults.\n" +
    "Pin each in supabase/config.toml. See update-password-confirmed outage\n" +
    "(2026-06-05) + mem://constraints/edge-function-config-pinning.\n",
  );
  failed = true;
}
if (invokedMissing.length > 0) {
  console.error(
    "\nFunctions invoked from src/ but NOT pinned in supabase/config.toml:\n" +
    invokedMissing.map((n) => `  - ${n}  (called via supabase.functions.invoke)`).join("\n") +
    "\n\nClient-invoked unpinned functions silently 404 in prod. Pin each one.\n",
  );
  failed = true;
}

if (failed) process.exit(1);

const pinnedCount = dirs.filter((n) => pinned.has(n)).length;
console.log(
  `OK: ${pinnedCount} edge functions pinned; ${dirs.length - pinnedCount - 1} on baseline allow-list; ` +
  `${invoked.size} client-invoked functions all pinned.`,
);
