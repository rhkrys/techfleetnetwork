/**
 * Point git at the committed, fork-free hooks directory (.githooks).
 *
 * Runs from the `prepare` npm lifecycle script (npm install / npm ci).
 *
 * Why this exists (replaces husky): git previously ran hooks through husky's
 * generated `.husky/_/h` loader, which forks subprocesses ($(basename),
 * $(dirname), `sh -e`). On Windows, MSYS2/Cygwin fork() fails with
 * STATUS_DLL_INIT_FAILED (0xC0000142) when the DLL rebase table is exhausted,
 * so `git commit` died silently BEFORE the real checks ran. `.githooks/*` are
 * plain committed scripts that only use shell builtins up to an `exec node`,
 * so no fork happens on the sh side.
 *
 * Guarded: a bare `npm install` outside a git checkout (e.g. from a tarball)
 * has no repo to configure — skip quietly instead of failing the install.
 */

import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// No .git dir → not a working checkout (CI cache restore, tarball install, …).
if (!fs.existsSync(path.join(repoRoot, ".git"))) {
  console.log("setup-git-hooks: no .git directory — skipping hooks setup");
  process.exit(0);
}

// Single command string + shell:true (not an args array) so Windows resolves
// git.exe via PATH without tripping Node's DEP0190 shell-args warning. The
// command is a static literal — no interpolation, so no injection surface.
const result = spawnSync("git config core.hooksPath .githooks", {
  cwd: repoRoot,
  stdio: "inherit",
  shell: true,
});

if (result.error || result.status !== 0) {
  // Never fail the install over hook wiring; a developer can re-run `npm i`.
  console.log("setup-git-hooks: could not set core.hooksPath (non-fatal)");
  process.exit(0);
}

console.log("setup-git-hooks: core.hooksPath -> .githooks");
