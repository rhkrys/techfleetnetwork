#!/usr/bin/env node
// CI guard (BLOCKING): no critical (Tier 0) email sender may gate on a member preference.
//
// Tier 0 = critical transactional email (interview invites, applicant status, observer grants,
// the agreement offer, resume reminder, ...). These must ALWAYS send; only global suppression can
// stop them. The core bug this rearchitecture fixes was gating them on `notify_announcements`
// (default false), silently dropping critical mail for ~87% of users. This guard fails if an edge
// function reads `notify_announcements` / `notify_training_opportunities`, unless it is on the
// allowlist of senders that legitimately still gate a non-Tier-0 email.
//
// Allowlist (shrinks over the rollout): (empty) — every Tier-1 sender now selects recipients by
// notify_opportunities. send-announcement-email and quest-nudge moved off notify_announcements in
// PR 5, so neither is allowlisted any longer.
//
// Scope: supabase/functions/<name>/**/*.ts (excluding _shared and .test.ts). _shared is the tier
// registry — it documents these column names in comments and is not a sender. The harness walk
// filters only by basename, so _shared is excluded by scoping the roots to the sender subdirs
// (a single, non-recursive readdirSync — the harness still owns the recursive scan of each root).
//
// Scan/fail-closed/zero-scan/evidence owned by the shared harness (_guard.mjs).
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { runScanGuard } from "./_guard.mjs";

const FUNCTIONS = "supabase/functions";
const ALLOW = new Set([]);
const PREF = /\bnotify_announcements\b|\bnotify_training_opportunities\b/;

// Sender subdirectories = every direct child dir of supabase/functions except _shared / allowlist.
// A missing FUNCTIONS dir throws here (fail closed); an empty result trips the harness misconfig
// guard (exit 2). Neither swallows an error into a green.
const roots = readdirSync(join(process.cwd(), FUNCTIONS))
  .filter((name) => name !== "_shared" && !ALLOW.has(name))
  .filter((name) => statSync(join(process.cwd(), FUNCTIONS, name)).isDirectory())
  .map((name) => `${FUNCTIONS}/${name}`);

// Remove block and line comments so a mention in a comment is not a "read".
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

runScanGuard({
  name: "check-no-tier0-preference-gate",
  roots,
  include: /\.ts$/,
  exclude: /\.test\.ts$/,
  rule(src) {
    if (!PREF.test(stripComments(src))) return [];
    return [
      {
        text:
          "Reads a member preference (notify_announcements / notify_training_opportunities). " +
          "Tier-0 senders must not gate on a preference. If this is a non-Tier-0 sender, add it to " +
          "the allowlist in scripts/ci/check-no-tier0-preference-gate.mjs with a reason.",
      },
    ];
  },
  summary: (n) => `${n} sender file(s)`,
});
