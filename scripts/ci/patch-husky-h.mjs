/**
 * Patches .husky/_/h and .husky/_/pre-commit after `husky` regenerates them
 * during npm install.
 *
 * Problem: husky's dispatcher uses $(basename) / $(dirname) command
 * substitutions and `sh -e "$s"` to invoke the hook. Each `$()` and `sh -e`
 * forks a new process. On Windows, MSYS2's fork can fail with
 * STATUS_DLL_INIT_FAILED (0xC0000142) when the DLL rebase table is exhausted,
 * making ALL shell-based git hooks fail.
 *
 * Fix applied to h:
 *   - Replace $() command substitutions with pure shell parameter expansions
 *     (${0##*/} = basename, ${0%/*} = dirname) — no fork.
 *   - Replace `sh -e "$s"` with `. "$s"` (source = no fork).
 *
 * Fix applied to pre-commit dispatcher:
 *   - Replace $(dirname "$0") with ${0%/*} — no fork.
 *
 * .husky/pre-commit then does `exec node scripts/ci/run-pre-commit.mjs` which
 * replaces sh.exe with node.exe using exec (no fork). All child-process
 * spawning from there uses Node's child_process.spawnSync → Windows
 * CreateProcess, not Cygwin fork.
 *
 * This patch runs every time `npm install` runs (via the `prepare` script),
 * keeping these gitignored files in sync.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const huskyDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../.husky/_"
);

function patchFile(filePath, patchFn) {
  if (!fs.existsSync(filePath)) {
    console.log(`patch-husky-h: ${path.basename(filePath)} not found — skipping`);
    return;
  }
  const original = fs.readFileSync(filePath, "utf8");
  const patched = patchFn(original);
  if (patched === original) {
    console.log(`patch-husky-h: ${path.basename(filePath)} already patched or format changed — skipping`);
    return;
  }
  fs.writeFileSync(filePath, patched, "utf8");
  console.log(`patch-husky-h: patched ${path.relative(process.cwd(), filePath)}`);
}

// Patch h: replace $(basename), $(dirname(...dirname...)), and `sh -e "$s"` with fork-free equivalents
patchFile(path.join(huskyDir, "h"), (src) =>
  src
    .replace(
      /n=\$\(basename "\$0"\)\ns=\$\(dirname "\$\(dirname "\$0"\)"\)\/\$n/,
      `# \${0##*/} = basename, two-level dirname: no fork (pure parameter expansion)\nn="\${0##*/}"\nd0="\${0%/*}"\ns="\${d0%/*}/\$n"`
    )
    .replace(
      /sh -e "\$s" "\$@"\nc=\$\?.*exit \$c\n?/s,
      `. "$s" "$@"\n`
    )
);

// Patch pre-commit dispatcher: replace $(dirname "$0") with ${0%/*}
patchFile(path.join(huskyDir, "pre-commit"), (src) =>
  src.replace(
    /\. "\$\(dirname "\$0"\)\/h"/,
    `. "\${0%/*}/h"`
  )
);
