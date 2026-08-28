#!/usr/bin/env node
/**
 * MIGRATION-APPLIED-001 gate (ADR-0020): every migration committed to
 * `supabase/migrations/` must actually be applied to the production database.
 *
 * WHY THIS EXISTS
 * ---------------
 * TFN's DB migrations are hand-applied (`supabase db push`), while edge functions
 * and the frontend auto-deploy on merge. So a migration can be committed, pass the
 * BLOCKING migration-smoke gate (which only proves it applies to a *fresh local*
 * Postgres), merge — and then silently never reach prod because a human forgot to
 * run `db push`. That exact gap caused the Discord-linking PGRST202 outage
 * (migration 20260809161000 was committed but never applied to prod).
 *
 * migration-smoke answers "do these migrations apply from scratch?".
 * THIS check answers a different question: "are the committed migrations actually
 * live on prod right now?". Nothing else in CI asks that.
 *
 * HOW IT WORKS (read-only — never writes to prod)
 * -----------------------------------------------
 * 1. Reads the version prefix of every `supabase/migrations/<version>_*.sql`.
 * 2. Reads the set of versions applied to prod from
 *    `supabase_migrations.schema_migrations` via the Supabase Management API SQL
 *    endpoint (POST /v1/projects/{ref}/database/query) — the same access token and
 *    project ref already used by config-preflight.yml / deploy-edge-functions.yml.
 *    No DB password or direct connection string is required.
 * 3. Reports drift:
 *      - UNAPPLIED = committed but not on prod  → the outage risk. Primary signal.
 *      - EXTRA     = on prod but not in the repo → history drift / ad-hoc SQL.
 *
 * ROLLOUT (ADR-0020, mirrors ADR-0009 "ratchet + observe, then block")
 * --------------------------------------------------------------------
 * - No SUPABASE_ACCESS_TOKEN configured  → SKIP green with a ::notice:: (self-heals
 *   the moment the secret is set), exactly like config-preflight's guard.
 * - Drift found, observe window (default) → ::warning:: + exit 0.
 * - Drift found, ENFORCE=1 (or --enforce)  → ::error:: + exit 1 (blocking); the
 *   existing "Main failure alert" workflow then pages Discord.
 *
 * Run locally:  SUPABASE_ACCESS_TOKEN=… SUPABASE_PROJECT_REF=… node scripts/ci/check-migrations-applied.mjs
 */
import { readdirSync, appendFileSync } from "node:fs";

const DIR = "supabase/migrations";
const CODE = "MIGRATION-APPLIED-001";
const ENFORCE =
  process.argv.includes("--enforce") ||
  /^(1|true|yes)$/i.test(process.env.ENFORCE ?? "");

const token = process.env.SUPABASE_ACCESS_TOKEN?.trim();
const ref = process.env.SUPABASE_PROJECT_REF?.trim();

/** Append a line to the GitHub Actions job summary, if running in CI. */
function summary(md) {
  const path = process.env.GITHUB_STEP_SUMMARY;
  if (!path) return;
  try {
    appendFileSync(path, md + "\n");
  } catch {
    /* summary is best-effort; never fail the check because of it */
  }
}

/** Skip-with-notice (green) — the self-healing guard, like config-preflight. */
function skip(reason) {
  console.log(`::notice::${CODE} SKIPPED — ${reason}`);
  summary(`### ${CODE}: skipped\n${reason}`);
  process.exit(0);
}

/** Report real drift and exit per the rollout mode (enforce → red). */
function drift(lines, summaryMd) {
  const level = ENFORCE ? "error" : "warning";
  for (const l of lines) console.log(`::${level}::${l}`);
  summary(summaryMd);
  process.exit(ENFORCE ? 1 : 0);
}

/**
 * Reachability / verification failure (API down, 5xx, 429, bad token, odd shape).
 * This is NOT schema drift and `supabase db push` cannot fix it, so it must NEVER
 * be a hard gate — always warn + exit 0, even in enforce mode. Only a *successful*
 * query that shows unapplied migrations is allowed to fail the build.
 */
function unreachable(msg) {
  console.log(
    `::warning::${CODE}: could not verify against prod — ${msg}. Not drift (db push cannot fix it); reachability is never a hard gate.`
  );
  summary(
    `### ${CODE}: could not reach prod\n${msg}\n\n_Reachability failure is warning-only by design — never blocks._`
  );
  process.exit(0);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1. Repo migration versions ------------------------------------------------
let repoVersions;
try {
  repoVersions = readdirSync(DIR)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => f.match(/^([0-9]+)_/)?.[1])
    .filter(Boolean);
} catch (e) {
  console.error(`❌ ${CODE}: cannot read ${DIR}: ${e.message}`);
  process.exit(1);
}
const repoSet = new Set(repoVersions);

// 2. Guard — activate only when the Management-API token is present ----------
if (!token) {
  skip(
    "SUPABASE_ACCESS_TOKEN not set on this project yet. Set it to activate the migration-applied gate (read-only Management-API query)."
  );
}
if (!ref) {
  skip("SUPABASE_PROJECT_REF not set — cannot target a project.");
}

// 3. Applied versions from prod (read-only Management-API SQL query) ---------
const QUERY =
  "select version from supabase_migrations.schema_migrations order by version;";
const ENDPOINT = `https://api.supabase.com/v1/projects/${ref}/database/query`;

/**
 * Read prod's applied-migration ledger. Retries transient failures (5xx / 429 /
 * network) a few times; a terminal 4xx (bad token / wrong ref) is not retried.
 * ANY failure to obtain a valid array of rows is a reachability problem →
 * unreachable() (warn + exit 0), never reported as drift.
 */
async function fetchApplied() {
  const ATTEMPTS = 3;
  let last = "unknown error";
  for (let i = 1; i <= ATTEMPTS; i++) {
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: QUERY }),
      });
      if (res.ok) {
        const json = await res.json().catch(() => null);
        if (Array.isArray(json)) return json;
        last = "unexpected response shape (expected a JSON array of {version} rows)";
      } else {
        const body = (await res.text().catch(() => "")).slice(0, 200);
        last = `HTTP ${res.status}${body ? ` — ${body}` : ""}`;
        // 4xx (except 429) means config, not a blip — retrying won't help.
        if (res.status < 500 && res.status !== 429) break;
      }
    } catch (e) {
      last = e.message;
    }
    if (i < ATTEMPTS) await sleep(500 * i);
  }
  unreachable(last); // exits 0 — control never returns here
}

const rows = await fetchApplied();
const appliedSet = new Set(rows.map((r) => String(r.version)));

// 4. Compare ----------------------------------------------------------------
const unapplied = [...repoSet].filter((v) => !appliedSet.has(v)).sort();
const extra = [...appliedSet].filter((v) => !repoSet.has(v)).sort();

if (unapplied.length === 0 && extra.length === 0) {
  console.log(
    `✓ ${CODE}: all ${repoSet.size} committed migrations are applied to prod (${ref}).`
  );
  summary(
    `### ${CODE}: in sync ✅\nAll **${repoSet.size}** committed migrations are applied to prod (\`${ref}\`).`
  );
  process.exit(0);
}

// Drift ---------------------------------------------------------------------
const lines = [];
const md = [`### ${CODE}: migration drift detected`];

if (unapplied.length) {
  lines.push(
    `${CODE}: ${unapplied.length} committed migration(s) NOT applied to prod (${ref}) — run \`supabase db push\`: ${unapplied.join(", ")}`
  );
  md.push(
    `\n**Committed but NOT applied to prod (${unapplied.length})** — the PGRST202 outage risk. Fix: \`supabase db push\`.\n`,
    ...unapplied.map((v) => `- \`${v}\``)
  );
}
if (extra.length) {
  lines.push(
    `${CODE}: ${extra.length} migration(s) applied to prod but absent from the repo — history drift: ${extra.join(", ")}`
  );
  md.push(
    `\n**Applied to prod but NOT in the repo (${extra.length})** — ad-hoc SQL or squashed history; reconcile before enabling auto-apply.\n`,
    ...extra.map((v) => `- \`${v}\``)
  );
}
md.push(
  `\n_${ENFORCE ? "Enforcing: this run fails." : "Observe window: warning only (set ENFORCE=1 to block — see ADR-0020)."}_`
);

drift(lines, md.join("\n"));
