#!/usr/bin/env node
/**
 * BDD incident gate (Wave 4).
 *
 * Enforces: every `known_issue_catalog` entry with `match_kind='fingerprint'`
 * and `is_active=true` MUST have at least one `bdd_scenarios` row whose
 * `notes` or `test_file` contains `incident:<pattern>` — i.e. the resolved
 * incident is locked in by a regression test reference.
 *
 * Exits 1 with a GitHub Actions summary if any fingerprint is uncovered.
 *
 * Env handling (epic W0.3b — fail closed in CI, skip only locally):
 * this gate runs ONLY in CI, so a missing Supabase env is a misconfiguration
 * (the repo vars/secrets were never pointed at the new project — epic W0.2),
 * not a reason to pass. It used to exit(0) silently on missing env, which made
 * it skip green in CI too — running as theater. Now: missing env in CI fails
 * loudly with an actionable message; missing env locally still skips so dev
 * isn't blocked.
 */

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

const inCI = process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true";

if (!url || !key) {
  if (inCI) {
    const msg =
      "bdd-incident-gate: SUPABASE_URL / (SERVICE_ROLE|ANON)_KEY are unset in CI — " +
      "this DB-backed gate cannot run and must not pass silently. " +
      "Point the GitHub Actions repo vars/secrets at the new project (epic W0.2).";
    const summaryPath = process.env.GITHUB_STEP_SUMMARY;
    if (summaryPath) {
      const fs = await import("node:fs");
      fs.appendFileSync(summaryPath, `## ❌ BDD incident gate — not configured\n\n${msg}\n`);
    }
    console.error(`::error::${msg}`);
    process.exit(1);
  }
  console.warn("bdd-incident-gate: Supabase env vars unset; skipping (local dev).");
  process.exit(0);
}

const headers = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  "Content-Type": "application/json",
};

async function fetchJson(path) {
  const r = await fetch(`${url}${path}`, { headers });
  if (!r.ok) {
    throw new Error(`${path} -> ${r.status} ${await r.text()}`);
  }
  return r.json();
}

// Only fingerprint-type entries are "resolved incidents" that must be locked in
// by a regression test — substring/regex rows are noise-silences, not incidents.
// The header comment always specified fingerprint-only; the query was missing
// the filter, so the browser-noise seed rows would false-positive the gate.
const fingerprints = await fetchJson(
  "/rest/v1/known_issue_catalog?select=pattern,reason,match_kind&is_active=eq.true&match_kind=eq.fingerprint"
);

if (!fingerprints.length) {
  console.log("bdd-incident-gate: no active fingerprints; nothing to check.");
  process.exit(0);
}

// Map each catalog pattern to a short stable tag (first 40 chars, slug-ish)
// so spec authors can write `incident:stale-chunk` without echoing full text.
function tagFor(pattern) {
  return pattern
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

const missing = [];
const seen = new Set();
for (const { pattern, reason } of fingerprints) {
  const tag = `incident:${tagFor(pattern)}`;
  if (seen.has(tag)) continue;
  seen.add(tag);
  const enc = encodeURIComponent(`*${tag}*`);
  const rows = await fetchJson(
    `/rest/v1/bdd_scenarios?select=scenario_id&or=(notes.ilike.${enc},test_file.ilike.${enc})&limit=1`
  );
  if (!rows.length) missing.push({ pattern, reason, tag });
}

if (missing.length === 0) {
  console.log(`bdd-incident-gate: OK — all ${fingerprints.length} fingerprint(s) covered.`);
  process.exit(0);
}

const summary = process.env.GITHUB_STEP_SUMMARY || "/dev/stderr";
const lines = [
  "## ❌ BDD incident gate",
  "",
  "The following resolved fingerprints in `known_issue_catalog` have **no**",
  "regression test reference in `bdd_scenarios` (looked for `incident:<fingerprint>`",
  "in `notes` or `test_file`):",
  "",
  ...missing.map((m) => `- \`${m.tag}\` — pattern: \`${m.pattern.slice(0, 80)}\` — ${m.reason}`),
  "",
  "Add a regression spec and tag the scenario with `incident:<tag>` (slug of the catalog pattern) before merging.",
];
const fs = await import("node:fs");
fs.appendFileSync(summary, lines.join("\n") + "\n");
console.error(lines.join("\n"));
process.exit(1);
