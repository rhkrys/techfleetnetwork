/**
 * Node.js pre-commit runner.
 *
 * Called by .husky/pre-commit via `exec node scripts/ci/run-pre-commit.mjs`.
 * Runs as a native Windows process (no Cygwin fork), so it works even when
 * the MSYS2 DLL fork table is exhausted (STATUS_DLL_INIT_FAILED / 0xC0000142).
 *
 * Replicates the logic that was previously inlined in .husky/pre-commit:
 *   1. npx lint-staged
 *   2. node scripts/ci/check-edge-function-coverage.mjs --fix
 *   3. git add supabase/config.toml supabase/functions.manifest.json
 *   4. node scripts/ci/check-edge-function-coverage.mjs  (verify, no --fix)
 */

import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import path from "path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const isMerge = process.argv.includes("--merge");

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    cwd: repoRoot,
    stdio: "inherit",
    shell: false,
    ...opts,
  });
  if (result.error) {
    console.error(`pre-commit: failed to spawn '${cmd}': ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

if (isMerge) {
  // Merge commits: skip lint-staged. The merged files were already linted in
  // their source branch, and lint-staged's git-stash breaks under MERGE_HEAD.
  console.log("[pre-commit] merge commit — skipping lint-staged");
} else {
  // 1. lint-staged (eslint --fix + prettier on staged files)
  run("npx", ["lint-staged"]);
}

// 2. Edge function coverage check + auto-fix
run("node", ["scripts/ci/check-edge-function-coverage.mjs", "--fix"]);

// 3. Stage the files the coverage check may have updated
const toStage = ["supabase/config.toml", "supabase/functions.manifest.json"];
run("git", ["add", "--", ...toStage]);

// 4. Final coverage check (must pass clean — no --fix)
run("node", ["scripts/ci/check-edge-function-coverage.mjs"]);
