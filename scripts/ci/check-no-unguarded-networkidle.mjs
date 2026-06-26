// CI guard (PRD P-15 / D-19 / UC-16): forbid unguarded
// waitForLoadState("networkidle") in E2E tests.
//
// On pages with Supabase realtime/polling the network never goes idle, so an
// unguarded call burns the full 45s timeout per test per shard. The fix is
// either waitForLoadState("domcontentloaded") or adding .catch(() => {}).
//
// Mirrors the PRD's grep:
//   grep -rn "waitForLoadState.*networkidle" e2e/ | grep -v ".catch"
// but is line-accurate and reports file:line for each offender.
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const ROOTS = ['e2e'];
const offenders = [];

async function walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (e) {
    if (e.code === 'ENOENT') return;
    throw e;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules') continue;
      await walk(p);
    } else if (/\.(ts|tsx|mjs|js)$/.test(e.name)) {
      const lines = (await readFile(p, 'utf8')).split('\n');
      lines.forEach((line, i) => {
        const hit = /waitForLoadState\(\s*['"]networkidle['"]/.test(line);
        if (!hit) return;
        // Guarded if this line OR the next two chain .catch( — handles
        // multi-line `.catch(() => {})` formatting.
        const window = [line, lines[i + 1] ?? '', lines[i + 2] ?? ''].join('\n');
        if (/\.catch\s*\(/.test(window)) return;
        offenders.push(`${p.replace(/\\/g, '/')}:${i + 1}: ${line.trim()}`);
      });
    }
  }
}

for (const r of ROOTS) await walk(r);

if (offenders.length) {
  console.error(
    `Unguarded waitForLoadState("networkidle") in ${offenders.length} location(s).\n` +
      `Use waitForLoadState("domcontentloaded") or add .catch(() => {}) to prevent 45s CI hangs.\n`,
  );
  for (const o of offenders) console.error('  • ' + o);
  process.exit(1);
}
console.log('OK: no unguarded networkidle waits in e2e.');
