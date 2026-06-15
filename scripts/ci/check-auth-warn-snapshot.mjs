#!/usr/bin/env node
/**
 * AUTH-ARCH-CUTOVER-023 — Ratchet guard for warn-level auth-invariants rules.
 *
 * Promoting `auth-invariants/no-direct-supabase-auth` (and siblings) to ESLint
 * `error` today would brick CI: 60+ legacy callsites still call
 * supabase.auth.* directly (MFA, OAuth callback, AuthContext bootstrap, …).
 *
 * Instead, snapshot the current per-file violation counts in
 * `scripts/ci/auth-warn-snapshot.json`. CI fails if any file's count grows or
 * a new file appears. Counts may only shrink — the snapshot ratchet drives
 * the legacy surface toward zero without a flag-day rewrite.
 *
 * To accept reductions, regenerate the snapshot:
 *   node scripts/ci/check-auth-warn-snapshot.mjs --write
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const SNAPSHOT_PATH = resolve("scripts/ci/auth-warn-snapshot.json");
const RULES = [
  "auth-invariants/no-direct-supabase-auth",
  "auth-invariants/no-direct-failure-counters",
  "auth-invariants/no-auth-storage-literals",
];

function collect() {
  let raw;
  try {
    raw = execSync("npx eslint src/ -f json", {
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch (e) {
    // ESLint exits non-zero when it finds error-level rule violations. We only
    // care about parsing its JSON report; surface stdout regardless of exit.
    raw = e.stdout ? e.stdout.toString() : "";
    if (!raw) throw e;
  }
  const data = JSON.parse(raw);
  const counts = {};
  for (const f of data) {
    for (const m of f.messages) {
      if (!RULES.includes(m.ruleId)) continue;
      const rel = f.filePath.replace(process.cwd() + "/", "");
      const k = `${rel}|${m.ruleId}`;
      counts[k] = (counts[k] || 0) + 1;
    }
  }
  return Object.keys(counts)
    .sort()
    .reduce((a, k) => {
      a[k] = counts[k];
      return a;
    }, {});
}


const current = collect();

if (process.argv.includes("--write")) {
  writeFileSync(
    SNAPSHOT_PATH,
    JSON.stringify(
      { generatedAt: new Date().toISOString().slice(0, 10), rules: RULES, counts: current },
      null,
      2,
    ) + "\n",
  );
  console.log(`[check-auth-warn-snapshot] wrote ${Object.keys(current).length} entries`);
  process.exit(0);
}

const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8")).counts;
const grew = [];
const newFiles = [];
for (const [k, v] of Object.entries(current)) {
  if (!(k in snapshot)) newFiles.push(`${k} (+${v})`);
  else if (v > snapshot[k]) grew.push(`${k} (${snapshot[k]} -> ${v})`);
}

if (grew.length || newFiles.length) {
  console.error("[check-auth-warn-snapshot] AUTH-ARCH-CUTOVER-023 ratchet violation:");
  if (newFiles.length) console.error("\n  New offending files:\n   - " + newFiles.join("\n   - "));
  if (grew.length) console.error("\n  Increased counts:\n   - " + grew.join("\n   - "));
  console.error("\nFix by routing through src/features/auth/** (sessionPort or a use-case service).");
  console.error("If the legacy surface genuinely shrank, run: node scripts/ci/check-auth-warn-snapshot.mjs --write\n");
  process.exit(1);
}

const shrank = Object.entries(snapshot).filter(([k, v]) => (current[k] || 0) < v);
if (shrank.length) {
  console.warn(
    `[check-auth-warn-snapshot] ${shrank.length} entries shrank — regenerate the snapshot to lock the new floor.`,
  );
}
console.log(`[check-auth-warn-snapshot] OK (${Object.keys(current).length} entries within snapshot)`);
