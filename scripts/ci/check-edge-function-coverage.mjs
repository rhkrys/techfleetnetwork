#!/usr/bin/env node
// Fails CI if any directory under supabase/functions/ lacks a [functions.<name>]
// block in supabase/config.toml AND isn't on the explicit baseline allow-list.
//
// Why: a function whose settings drift to platform defaults can silently stop
// being deployed (or get the wrong verify_jwt). This script turns that class
// of incident (e.g. Get Help losing freescout-proxy) into a red build for any
// NEW function. The baseline below is today's "intentionally inheriting
// defaults" set — every entry should eventually be pinned in config.toml and
// removed from this list. A function added after today MUST be pinned.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const FN_DIR = join(ROOT, "supabase", "functions");
const CONFIG = join(ROOT, "supabase", "config.toml");

// Adding to this list is a deliberate, reviewed choice — not a workaround.
// Prefer pinning the function in supabase/config.toml.
const BASELINE_DEFAULT_FUNCTIONS = new Set([
  "_shared",
  "admin-purge-auth-user", "admin-sign-out-all-users", "airtable-diag",
  "backfill-discord-usernames", "bump-email-warmup", "delete-account",
  "discord-project-update", "dsar-submit", "email-pipeline-health",
  "fetch-class-certifications", "fetch-project-certifications",
  "fill-content-gaps", "firecrawl-search", "fleety-bulk-draft-playbooks",
  "framework-csv-fetch", "geo-hint", "get-community-events",
  "grant-observer-role", "gumroad-backfill", "ingest-reference-csv",
  "login-with-captcha", "manage-discord-roles", "mark-interview-scheduled",
  "notify-applicant-status", "notify-class-published", "prewarm-ugc-worker",
  "process-notification-fanout", "promote-to-teacher", "quest-nudge",
  "rate-limit", "record-consent", "record-policy-acknowledgment",
  "refresh-community-events", "refresh-email-health", "repair-discord-username",
  "replay-dlq-emails", "resend-signup-confirmations", "revoke-recording-consent",
  "revoke-teacher-role", "revoke-user-sessions", "save-form-draft",
  "scrape-figma-workshops", "screen-sanctions", "seed-content",
  "send-announcement-email", "send-community-agreement-trigger",
  "send-magic-link", "send-project-blast", "send-push-notification",
  "sign-out-all-devices", "submit-dispute", "support-monthly-report",
  "support-provisioning-retry", "sync-airtable", "sync-airtable-network-stats",
  "translate-bundle", "translate-strings", "update-password-confirmed",
  "validate-email-domain", "verify-turnstile", "write-exploration-cache",
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
  (name) => !pinned.has(name) && !BASELINE_DEFAULT_FUNCTIONS.has(name),
);

if (missing.length > 0) {
  console.error(
    "Edge functions without a [functions.<name>] block in supabase/config.toml:\n" +
    missing.map((n) => `  - ${n}`).join("\n") +
    "\n\nPin each function with an explicit config block in supabase/config.toml,\n" +
    "e.g.\n  [functions.my-fn]\n    verify_jwt = true\n\n" +
    "Inheriting platform defaults can silently change deployment behavior\n" +
    "(see Get Help incident, June 2026). New functions must be pinned.",
  );
  process.exit(1);
}

const pinnedCount = dirs.filter((n) => pinned.has(n)).length;
console.log(`OK: ${pinnedCount} edge functions pinned; ${dirs.length - pinnedCount - 1} on baseline allow-list.`);
