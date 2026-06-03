#!/usr/bin/env node
/**
 * CI guard for Part 1 §1.1 — Audit-log tri-partite sink architecture.
 *
 * Verifies that every public-schema table has an explicit row in
 * `public.audit_sink_registry`. Without this guard, a newly added table can
 * silently double-write into audit_log (KPI #1 regresses) or fan out into
 * notifications without dedupe (KPI #11 regresses).
 *
 * Usage (CI):
 *   node scripts/ci/check-audit-sink-coverage.mjs
 *
 * Auth: reads PG* env vars (already set in CI sandbox). In environments
 * without psql we exit 0 with a warning so local dev is not blocked.
 */

import { execSync } from 'node:child_process';

function hasPsql() {
  try {
    execSync('psql --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function q(sql) {
  return execSync(`psql -At -F$'\\t' -c ${JSON.stringify(sql)}`, {
    encoding: 'utf8',
  }).trim();
}

if (!hasPsql() || !process.env.PGHOST) {
  console.warn('[audit-sink-coverage] psql/PGHOST not available — skipping.');
  process.exit(0);
}

const publicTables = q(`
  SELECT tablename FROM pg_tables
  WHERE schemaname='public'
    AND tablename NOT LIKE 'pg_%'
    AND tablename NOT LIKE '_realtime%'
  ORDER BY 1
`)
  .split('\n')
  .filter(Boolean);

const registered = new Set(
  q(`SELECT table_name FROM public.audit_sink_registry`)
    .split('\n')
    .filter(Boolean),
);

const missing = publicTables.filter((t) => !registered.has(t));

if (missing.length) {
  console.error(
    '\n[audit-sink-coverage] FAIL — these tables have no row in audit_sink_registry:\n',
  );
  for (const t of missing) console.error(`  • ${t}`);
  console.error(
    '\nFix: add a migration with INSERT INTO public.audit_sink_registry (table_name, mode, sink, notes) VALUES (...).',
  );
  console.error(
    "Pick mode 'semantic' if you audit specific events, 'none' if no audit, 'generic' only as a transitional escape hatch.\n",
  );
  process.exit(1);
}

console.log(
  `[audit-sink-coverage] OK — ${publicTables.length} tables, all registered.`,
);
