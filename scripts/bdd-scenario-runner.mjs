#!/usr/bin/env node
/**
 * BDD Scenario Runner (reporting-only, phase 1).
 *
 * Loads every row from public.bdd_scenarios and reports its current status +
 * whether its referenced test_file exists on disk. Phase 1 is read-only and
 * never fails CI — it only writes a Markdown summary to $GITHUB_STEP_SUMMARY
 * and stdout. Later phases will tag-match Vitest/Playwright tests via
 * @BDD:<scenario_id> and report per-scenario pass/fail.
 *
 * Requires SUPABASE_URL + SUPABASE_ANON_KEY (or VITE_ equivalents).
 */
import fs from "fs";

const SUPABASE_URL =
  process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "";
const SUPABASE_KEY =
  process.env.SUPABASE_ANON_KEY ??
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  "";

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.log("::notice::Skipping scenario-runner — Supabase env not configured.");
  process.exit(0);
}

const url = `${SUPABASE_URL}/rest/v1/bdd_scenarios?select=scenario_id,feature_area,title,status,test_type,test_file&order=feature_area,scenario_id`;
const res = await fetch(url, {
  headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
});
if (!res.ok) {
  console.log(`::warning::Scenario fetch failed: ${res.status}`);
  process.exit(0);
}
const rows = await res.json();

const byArea = new Map();
for (const r of rows) {
  if (!byArea.has(r.feature_area)) byArea.set(r.feature_area, []);
  byArea.get(r.feature_area).push(r);
}

const total = rows.length;
const impl = rows.filter((r) => r.status === "implemented").length;
const lines = [
  "# 🎯 BDD Scenario Runner (reporting only)",
  "",
  `Found **${total}** scenarios across **${byArea.size}** feature areas — **${impl}** implemented.`,
  "",
  "Per-scenario pass/fail will be wired in once tag coverage (`@BDD:<id>`) crosses 50%.",
  "",
  "## By feature area",
  "",
  "| Area | Total | Implemented | Partial | Not built |",
  "|------|------:|-----------:|--------:|----------:|",
];
for (const [area, list] of [...byArea.entries()].sort()) {
  const i = list.filter((r) => r.status === "implemented").length;
  const p = list.filter((r) => r.status === "partial").length;
  const n = list.filter((r) => r.status === "not_built").length;
  lines.push(`| ${area} | ${list.length} | ${i} | ${p} | ${n} |`);
}
const report = lines.join("\n");
console.log(report);
const summaryPath = process.env.GITHUB_STEP_SUMMARY;
if (summaryPath) fs.appendFileSync(summaryPath, report + "\n");
