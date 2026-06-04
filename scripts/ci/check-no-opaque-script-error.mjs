#!/usr/bin/env node
// TRIAGE-NOISE-033: Fail CI if any opaque cross-origin "Script error." row has
// landed in agent_fix_queue or audit_log in the last 24h. The DB BEFORE INSERT
// trigger reject_opaque_script_error should make this impossible — a hit means
// the trigger regressed or a new reporter path bypassed it, and we want a red
// build instead of silent noise in admin Triage.
//
// Requires PG* env vars (set in CI). Skips with exit 0 when not configured so
// local dev runs aren't broken.

import { Client } from "pg";

const REQUIRED = ["PGHOST", "PGUSER", "PGDATABASE"];
if (REQUIRED.some((k) => !process.env[k])) {
  console.log("[check-no-opaque-script-error] PG env not configured — skipping");
  process.exit(0);
}

const REGEX = String.raw`^(error:\s*)?script error\.?(\n|$)`;
const client = new Client();

try {
  await client.connect();
  const since = "now() - interval '24 hours'";

  const fix = await client.query(
    `SELECT id, status, last_seen_at, left(error_message, 200) AS preview
     FROM public.agent_fix_queue
     WHERE error_message ~* $1 AND last_seen_at > ${since}
     ORDER BY last_seen_at DESC LIMIT 20`,
    [REGEX],
  );
  const audit = await client.query(
    `SELECT id, created_at, left(error_message, 200) AS preview
     FROM public.audit_log
     WHERE error_message ~* $1 AND created_at > ${since}
     ORDER BY created_at DESC LIMIT 20`,
    [REGEX],
  );

  if (fix.rows.length === 0 && audit.rows.length === 0) {
    console.log("[check-no-opaque-script-error] OK — no opaque Script error rows in last 24h");
    process.exit(0);
  }

  console.error("[check-no-opaque-script-error] FAIL — opaque Script error rows detected:");
  if (fix.rows.length) {
    console.error(`\nagent_fix_queue (${fix.rows.length}):`);
    for (const r of fix.rows) console.error(` - ${r.id} [${r.status}] ${r.last_seen_at}\n   ${r.preview}`);
  }
  if (audit.rows.length) {
    console.error(`\naudit_log (${audit.rows.length}):`);
    for (const r of audit.rows) console.error(` - ${r.id} ${r.created_at}\n   ${r.preview}`);
  }
  console.error("\nThe reject_opaque_script_error BEFORE INSERT trigger should have blocked these.");
  console.error("Investigate which reporter path bypassed it. See mem://features/triage-noise-suppression.");
  process.exit(1);
} catch (err) {
  console.error("[check-no-opaque-script-error] query error:", err.message);
  process.exit(1);
} finally {
  await client.end().catch(() => {});
}
