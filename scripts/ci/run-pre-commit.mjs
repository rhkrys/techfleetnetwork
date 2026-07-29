/**
 * Node.js pre-commit runner.
 *
 * Called by .githooks/pre-commit via `exec node scripts/ci/run-pre-commit.mjs`.
 * Runs as a native Windows process (no Cygwin fork), so it works even when
 * the MSYS2 DLL fork table is exhausted (STATUS_DLL_INIT_FAILED / 0xC0000142).
 *
 * Replicates the logic that was previously inlined in the git pre-commit hook:
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

// When invoked via `exec node` from an MSYS2/Cygwin sh.exe hook, PATH is
// POSIX-style (/c/Program Files/nodejs) which native Windows node.exe can't
// resolve.  Convert those entries back to Windows paths (C:\...) before
// spawning any child processes.
function fixedEnv() {
  if (process.platform !== "win32") return process.env;
  const rawPath = process.env.PATH || process.env.Path || "";
  if (!rawPath.includes(":/")) return process.env;

  // GIT_EXEC_PATH = C:/Git/mingw64/libexec/git-core → gitRoot = C:/Git
  // This lets us convert MSYS2 mount-points /cmd and /mingw64/bin which
  // lint-staged needs to find git.exe.
  const gitExecPath = process.env.GIT_EXEC_PATH || "";
  const gitRoot = gitExecPath
    ? path.resolve(gitExecPath.replace(/\//g, path.sep), "..", "..", "..") + path.sep
    : null;

  const winPATH = rawPath
    .split(":")
    .map((p) => {
      if (p.match(/^\/([a-zA-Z])\//)) {
        // /c/foo → C:\foo
        return p.replace(/^\/([a-zA-Z])\//, (_, d) => d.toUpperCase() + ":\\").replace(/\//g, "\\");
      }
      if (gitRoot) {
        if (p === "/cmd") return path.join(gitRoot, "cmd");
        if (p === "/mingw64/bin") return path.join(gitRoot, "mingw64", "bin");
        if (p === "/usr/bin") return path.join(gitRoot, "usr", "bin");
        if (p === "/usr/local/bin") return path.join(gitRoot, "usr", "local", "bin");
        if (p === "/bin") return path.join(gitRoot, "usr", "bin");
      }
      return p; // leave unresolvable MSYS2 mount-points as-is
    })
    .join(";");
  return { ...process.env, PATH: winPATH };
}

const env = fixedEnv();

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    cwd: repoRoot,
    stdio: "inherit",
    // On Windows: .cmd/.bat wrappers (npx, npm, etc.) require cmd.exe.
    // shell:true also ensures the Windows PATH (after fixedEnv conversion) is used.
    shell: isWin,
    env,
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

// On Windows, npm CLI wrappers (.cmd files) require cmd.exe — run()'s
// shell option handles this; we keep command names portable across platforms.
const isWin = process.platform === "win32";

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
