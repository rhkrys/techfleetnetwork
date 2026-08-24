#!/usr/bin/env node
// CI guard (BLOCKING): no critical (Tier 0) email sender may gate on a member preference.
//
// Tier 0 = critical transactional email (interview invites, applicant status, observer grants,
// the agreement offer, resume reminder, ...). These must ALWAYS send; only global suppression can
// stop them. The core bug this whole rearchitecture fixes was gating them on `notify_announcements`
// (default false), silently dropping critical mail for ~87% of users. This guard prevents that
// class of regression: it fails if an edge function reads `notify_announcements` /
// `notify_training_opportunities` in code, unless it is on the allowlist of senders that
// legitimately still gate a non-Tier-0 email (removed as each is migrated).
//
// Allowlist (shrinks over the rollout):
//   (empty) - every Tier-1 sender now selects recipients by notify_opportunities.
//   History: send-announcement-email and quest-nudge were both moved off notify_announcements to
//   notify_opportunities in PR 5, so neither is allowlisted any longer. The announcement composer
//   still gets a "this is not marketing" attestation in PR 7 to keep marketing in Email Octopus,
//   but that is a content-governance gate, not a recipient-preference gate, so it is out of scope
//   for this check.
//
// Scope: supabase/functions/<name>/*.ts, excluding _shared (the tier registry documents these
// column names in comments/notes and is not a sender).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const DIR = join(ROOT, "supabase", "functions");
const ALLOW = new Set([]);
const PREF = /\bnotify_announcements\b|\bnotify_training_opportunities\b/;

// Remove block and line comments so a mention in a comment is not a "read".
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

function tsFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...tsFiles(p));
    else if (name.endsWith(".ts")) out.push(p);
  }
  return out;
}

let violations = 0;
for (const name of readdirSync(DIR)) {
  if (name === "_shared") continue;
  const fnDir = join(DIR, name);
  if (!statSync(fnDir).isDirectory()) continue;
  if (ALLOW.has(name)) continue;
  for (const f of tsFiles(fnDir)) {
    if (f.endsWith(".test.ts")) continue;
    const code = stripComments(readFileSync(f, "utf8"));
    if (PREF.test(code)) {
      console.error(
        `✖ ${relative(ROOT, f).replace(/\\/g, "/")}\n` +
          `   Reads a member preference (notify_announcements / notify_training_opportunities).\n` +
          `   Tier-0 senders must not gate on a preference. If this is a non-Tier-0 sender, add it\n` +
          `   to the allowlist in scripts/ci/check-no-tier0-preference-gate.mjs with a reason.`
      );
      violations++;
    }
  }
}

if (violations > 0) {
  console.error(`\n${violations} Tier-0 preference-gate violation(s) found.`);
  process.exit(1);
}
console.log("✓ check-no-tier0-preference-gate: no critical sender gates on a member preference.");
