/**
 * Patches .husky/_/h and .husky/_/pre-commit after `husky` regenerates them
 * during npm install.
 *
 * Root problem on Windows: MSYS2's fork() fails with STATUS_DLL_INIT_FAILED
 * (0xC0000142) when the DLL rebase table is exhausted.  This affects every
 * sh.exe child-process spawn, killing all git hooks.
 *
 * Three fixes, applied to every .husky/_/ file after each `npm install`:
 *
 * 1. Shebang: change `#!/usr/bin/env sh` → `#!/bin/sh`.
 *    With `#!/usr/bin/env sh`, git runs env.exe which fork-execs sh.exe
 *    (MSYS2→MSYS2 fork = broken).  With `#!/bin/sh`, git maps /bin/sh
 *    directly to sh.exe and starts it via CreateProcess (no fork).
 *
 * 2. Dispatchers: replace `. "$(dirname "$0")/h"` with `. "${0%/*}/h"`.
 *    $() creates a subshell (fork); ${} is pure parameter expansion (no fork).
 *
 * 3. h runner: replace $(basename)/$(dirname) with parameter expansions and
 *    replace `sh -e "$s"` with `. "$s"` (source runs in current process).
 *
 * .husky/pre-commit then does `exec node scripts/ci/run-pre-commit.mjs` which
 * replaces sh.exe with node.exe via CreateProcess (no fork). All further
 * child-process spawning uses Node's spawnSync → Windows CreateProcess.
 *
 * This patch runs every time `npm install` runs (via the `prepare` script),
 * keeping these gitignored files in sync.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const huskyDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.husky/_");

function patchFile(filePath, patchFn) {
  if (!fs.existsSync(filePath)) {
    console.log(`patch-husky-h: ${path.basename(filePath)} not found — skipping`);
    return;
  }
  const original = fs.readFileSync(filePath, "utf8");
  const patched = patchFn(original);
  if (patched === original) {
    console.log(
      `patch-husky-h: ${path.basename(filePath)} already patched or format changed — skipping`
    );
    return;
  }
  fs.writeFileSync(filePath, patched, "utf8");
  console.log(`patch-husky-h: patched ${path.relative(process.cwd(), filePath)}`);
}

const ALL_FILES = fs.readdirSync(huskyDir).filter((n) => !n.startsWith("."));

// Fix 1 (all files): #!/usr/bin/env sh → #!/bin/sh
// env.exe fork-execs sh.exe (MSYS2→MSYS2 fork = broken on Windows).
// #!/bin/sh maps directly to sh.exe via CreateProcess (no fork).
for (const name of ALL_FILES) {
  patchFile(path.join(huskyDir, name), (src) => src.replace("#!/usr/bin/env sh", "#!/bin/sh"));
}

// Fix 2 (h only): basename/dirname subshells → parameter expansions + source instead of sh -e
patchFile(path.join(huskyDir, "h"), (src) =>
  src
    .replace(
      /n=\$\(basename "\$0"\)\ns=\$\(dirname "\$\(dirname "\$0"\)"\)\/\$n/,
      `# \${0##*/} = basename, two-level dirname: no fork (pure parameter expansion)\nn="\${0##*/}"\nd0="\${0%/*}"\ns="\${d0%/*}/\$n"`
    )
    .replace(/sh -e "\$s" "\$@"\nc=\$\?.*exit \$c\n?/s, `. "$s" "$@"\n`)
);

// Fix 3 (dispatchers): $(dirname "$0") → ${0%/*}
const dispatchers = ALL_FILES.filter((n) => n !== "h" && n !== "husky.sh");
for (const name of dispatchers) {
  patchFile(path.join(huskyDir, name), (src) =>
    src.replace(/\. "\$\(dirname "\$0"\)\/h"/, `. "\${0%/*}/h"`)
  );
}
