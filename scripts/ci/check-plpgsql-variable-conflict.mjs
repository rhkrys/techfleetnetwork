#!/usr/bin/env node
// Fails CI when a new/edited plpgsql function in supabase/migrations declares
// RETURNS TABLE (...) without `#variable_conflict use_column` at the top of
// the body. Postgres OUT-parameter names shadow column references inside the
// function body, raising `column reference "X" is ambiguous` at call time
// (see get_refactor_kpis incident, 2026-06-04). This guard makes that class
// of bug structurally impossible going forward.
//
// Escape hatch: place `-- @safe-variable-conflict` on the line immediately
// before the function when you have manually proven no shadowing exists.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const MIG_DIR = join(ROOT, "supabase", "migrations");

// Grandfathered: functions retrofitted at runtime by the 2026-06-04
// plpgsql_variable_conflict_backfill migration. The ORIGINAL historical
// CREATE statements for these functions are excused; any *new* migration
// redefining one of them must include `#variable_conflict use_column`.
const BASELINE_FUNCTIONS = new Set([
  "public._upsert_kpi","public.block_non_actionable_fix_queue_inserts",
  "public.bump_kb_version","public.claim_idempotency_key",
  "public.compute_error_fingerprint","public.discover_audit_fingerprints",
  "public.email_message_ids_in_queue","public.email_send_log_latest_stuck",
  "public.encrypt_pii","public.enqueue_email","public.evaluate_system_health",
  "public.fleety_cache_lookup","public.fleety_cache_semantic_lookup",
  "public.fleety_cost_guard_step","public.fleety_cost_projection",
  "public.fleety_match_canned_answers","public.fleety_match_playbooks",
  "public.fn_emit_badge","public.freescout_enqueue_event",
  "public.fw_emit_edges_for_entity","public.fw_entity_key_to_type",
  "public.fw_rename_jsonb_keys","public.fw_replay_staging",
  "public.get_community_events_health","public.get_project_internal_links",
  "public.get_refactor_kpis","public.get_support_monthly_report",
  "public.get_top_silent_failures","public.list_admin_email_recipients",
  "public.notify_project_opening","public.pgmq_read_archive",
  "public.policy_versions_block_delete","public.prune_cron_job_run_details",
  "public.read_email_batch","public.refresh_support_monthly_report",
  "public.replay_frequency_capped","public.run_refactor_kpis_snapshot_now",
  "public.search_framework","public.snapshot_refactor_kpis",
  "public.support_check_rate_limit","public.tg_hash_chain",
  "public.trg_notify_class_status_change","public.validate_invitation",
  "public.verify_admin_promotion_token","public.web_vitals_p75",
]);

// Migration files at or before this stamp are part of the baseline. Anything
// newer must comply regardless of whether the function is grandfathered.
const BASELINE_CUTOFF = "20260604170800";


function listSqlFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...listSqlFiles(p));
    else if (name.endsWith(".sql")) out.push(p);
  }
  return out;
}

// Matches:  CREATE [OR REPLACE] FUNCTION ... RETURNS TABLE (...) ... LANGUAGE plpgsql ... AS $tag$ <body> $tag$
const FN_RE =
  /(--\s*@safe-variable-conflict\s*\n)?\s*CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([^\s(]+)[\s\S]*?RETURNS\s+TABLE\s*\([\s\S]*?\)[\s\S]*?LANGUAGE\s+plpgsql[\s\S]*?AS\s+(\$[A-Za-z_]*\$)([\s\S]*?)\3/gi;

let violations = 0;
const seen = []; // for human-friendly summary

for (const file of listSqlFiles(MIG_DIR)) {
  const stamp = file.split("/").pop().slice(0, 14); // YYYYMMDDHHMMSS prefix
  const isBaselineFile = stamp <= BASELINE_CUTOFF;
  const sql = readFileSync(file, "utf8");
  let m;
  while ((m = FN_RE.exec(sql)) !== null) {
    const safe = !!m[1];
    const fnName = m[2];
    const body = m[4];
    seen.push(fnName);
    if (safe) continue;
    if (/#variable_conflict\s+use_column/i.test(body)) continue;
    if (isBaselineFile && BASELINE_FUNCTIONS.has(fnName)) continue;
    violations++;
    const rel = file.replace(ROOT + "/", "");
    console.error(
      `✖ ${rel}\n   Function ${fnName} returns TABLE(...) but is missing\n   '#variable_conflict use_column' as the first line of the function body.\n   Fix: insert that line right after AS $$ (or $function$) — see\n   docs/runbooks/plpgsql-variable-conflict.md or get_refactor_kpis.`,
    );
  }
}


if (violations > 0) {
  console.error(
    `\n${violations} plpgsql RETURNS TABLE function(s) missing the variable_conflict directive.`,
  );
  process.exit(1);
}

console.log(
  `✓ check-plpgsql-variable-conflict: ${seen.length} RETURNS TABLE function definition(s) inspected, all safe.`,
);
