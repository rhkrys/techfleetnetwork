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
 * Skips silently when Supabase env vars are missing (local dev).
 */

const url = process.env.SUPABASE_URL;
const key =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_ANON_KEY;

if (!url || !key) {
  console.warn("bdd-incident-gate: Supabase env vars unset; skipping.");
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

const fingerprints = await fetchJson(
  "/rest/v1/known_issue_catalog?select=pattern,reason&match_kind=eq.fingerprint&is_active=eq.true"
);

if (!fingerprints.length) {
  console.log("bdd-incident-gate: no active fingerprints; nothing to check.");
  process.exit(0);
}

const missing = [];
for (const { pattern, reason } of fingerprints) {
  const tag = `incident:${pattern}`;
  const enc = encodeURIComponent(`*${tag}*`);
  const rows = await fetchJson(
    `/rest/v1/bdd_scenarios?select=scenario_id&or=(notes.ilike.${enc},test_file.ilike.${enc})&limit=1`
  );
  if (!rows.length) missing.push({ pattern, reason });
}

if (missing.length === 0) {
  console.log(
    `bdd-incident-gate: OK — all ${fingerprints.length} fingerprint(s) covered.`
  );
  process.exit(0);
}

const summary =
  process.env.GITHUB_STEP_SUMMARY ||
  "/dev/stderr";
const lines = [
  "## ❌ BDD incident gate",
  "",
  "The following resolved fingerprints in `known_issue_catalog` have **no**",
  "regression test reference in `bdd_scenarios` (looked for `incident:<fingerprint>`",
  "in `notes` or `test_file`):",
  "",
  ...missing.map((m) => `- \`${m.pattern}\` — ${m.reason}`),
  "",
  "Add a regression spec and tag the scenario with `incident:<fingerprint>` before merging.",
];
const fs = await import("node:fs");
fs.appendFileSync(summary, lines.join("\n") + "\n");
console.error(lines.join("\n"));
process.exit(1);
