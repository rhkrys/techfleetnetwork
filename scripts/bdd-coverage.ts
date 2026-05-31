/**
 * BDD Coverage Report
 *
 * Compares scenarios stored in the bdd_scenarios table against physical test
 * files in the repository.  Outputs a markdown summary to stdout and sets
 * the GITHUB_STEP_SUMMARY env-var when running in CI.
 *
 * Usage:
 *   npx tsx scripts/bdd-coverage.ts
 *
 * Requires VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY (or
 * SUPABASE_URL / SUPABASE_ANON_KEY) in the environment.
 */

import fs from "fs";
import path from "path";

const SUPABASE_URL =
  process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "";
const SUPABASE_KEY =
  process.env.SUPABASE_ANON_KEY ??
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  "";

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error(
    "Missing SUPABASE_URL / SUPABASE_ANON_KEY (or VITE_ equivalents)."
  );
  process.exit(1);
}

interface Scenario {
  scenario_id: string;
  feature_area: string;
  title: string;
  test_type: string;
  status: string;
  test_file: string | null;
  notes: string | null;
}

interface CatalogEntry {
  id: string;
  pattern: string;
  reason: string | null;
}

async function fetchScenarios(): Promise<Scenario[]> {
  const url = `${SUPABASE_URL}/rest/v1/bdd_scenarios?select=scenario_id,feature_area,title,test_type,status,test_file,notes&order=feature_area,scenario_id`;
  const res = await fetch(url, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
  });
  if (!res.ok) throw new Error(`Supabase query failed: ${res.status}`);
  return res.json();
}

function testFileExists(testFile: string | null): boolean {
  if (!testFile || testFile.trim() === "") return false;
  return fs.existsSync(path.resolve(process.cwd(), testFile));
}

async function main() {
  const scenarios = await fetchScenarios();

  const total = scenarios.length;
  const implemented = scenarios.filter((s) => s.status === "implemented").length;
  const partial = scenarios.filter((s) => s.status === "partial").length;
  const notBuilt = scenarios.filter((s) => s.status === "not_built").length;
  const manual = scenarios.filter((s) => s.test_type === "manual").length;

  const withFile = scenarios.filter(
    (s) => s.test_file && s.test_file.trim() !== ""
  );
  const filesMissing = withFile.filter((s) => !testFileExists(s.test_file));

  // Group not_built by feature area
  const notBuiltByArea = scenarios
    .filter((s) => s.status === "not_built")
    .reduce<Record<string, Scenario[]>>((acc, s) => {
      (acc[s.feature_area] ??= []).push(s);
      return acc;
    }, {});

  const coveragePct = total > 0 ? ((implemented / total) * 100).toFixed(1) : "0";

  const lines: string[] = [
    "# 🧪 BDD Coverage Report",
    "",
    `| Metric | Count |`,
    `|--------|------:|`,
    `| Total scenarios | ${total} |`,
    `| ✅ Implemented | ${implemented} |`,
    `| 🟡 Partial | ${partial} |`,
    `| ❌ Not built | ${notBuilt} |`,
    `| 📋 Manual only | ${manual} |`,
    `| **Coverage** | **${coveragePct}%** |`,
    "",
  ];

  if (filesMissing.length > 0) {
    lines.push(
      "## ⚠️ Missing test files",
      "",
      "These scenarios reference a test file that does not exist in the repo:",
      "",
      "| Scenario | Expected file |",
      "|----------|--------------|",
      ...filesMissing.map(
        (s) => `| ${s.scenario_id} — ${s.title} | \`${s.test_file}\` |`
      ),
      "",
    );
  }

  if (Object.keys(notBuiltByArea).length > 0) {
    lines.push("## 🔨 Unbuilt scenarios by feature area", "");
    for (const [area, items] of Object.entries(notBuiltByArea).sort(
      ([a], [b]) => a.localeCompare(b)
    )) {
      lines.push(
        `### ${area} (${items.length})`,
        ...items.map(
          (s) =>
            `- **${s.scenario_id}** ${s.title} _(${s.test_type})_`
        ),
        "",
      );
    }
  }

  const report = lines.join("\n");
  console.log(report);

  // Write to GitHub step summary if available
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    fs.appendFileSync(summaryPath, report);
  }

  // ---------------------------------------------------------------------------
  // CI gates (ratchet pattern — raise thresholds over time, never lower them)
  // ---------------------------------------------------------------------------
  let failed = false;

  // Gate 1: hard-fail on orphaned test_file references (broken catalog data).
  if (filesMissing.length > 0) {
    console.error(
      `\n❌ ${filesMissing.length} scenario(s) reference test files that do not exist on disk.`
    );
    failed = true;
  }

  // Gate 2: implementation-rate ratchet — every scenario marked `implemented`
  // counts. Current real coverage is ~84%; threshold is set just below to
  // absorb minor churn.
  const COVERAGE_THRESHOLD = 80;
  if (parseFloat(coveragePct) < COVERAGE_THRESHOLD) {
    console.error(
      `\n❌ BDD coverage ${coveragePct}% is below ${COVERAGE_THRESHOLD}% threshold.`
    );
    failed = true;
  }

  // Gate 3: an `implemented` scenario MUST point to a real test file.
  // Without this gate, scenarios can be silently flipped to "implemented"
  // with test_file = "" and falsely pass Gate 2. We allow `manual` test_type
  // to remain unlinked because those are intentional human-verified cases.
  const implementedUnlinked = scenarios.filter(
    (s) =>
      s.status === "implemented" &&
      s.test_type !== "manual" &&
      (!s.test_file || s.test_file.trim() === "")
  );
  // Ratchet baseline: as of 2026-04-24 every implemented scenario is
  // linked to a real test file. Hold the line at 0 — any new "implemented"
  // row without a test_file fails CI immediately. Lower this number over
  // time, never raise it.
  const IMPLEMENTED_UNLINKED_MAX = 0;
  if (implementedUnlinked.length > IMPLEMENTED_UNLINKED_MAX) {
    console.error(
      `\n❌ ${implementedUnlinked.length} scenario(s) marked "implemented" have no test_file.\n` +
        `   Allowed ceiling: ${IMPLEMENTED_UNLINKED_MAX}. Either link a real test or downgrade status to "partial".`
    );
    failed = true;
  } else if (implementedUnlinked.length > 0) {
    // Surface a warning even when under the cap so the number is always visible.
    console.warn(
      `\n⚠️  ${implementedUnlinked.length} scenario(s) marked "implemented" have no test_file ` +
        `(under the current ceiling of ${IMPLEMENTED_UNLINKED_MAX} — please ratchet down).`
    );
  }

  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
