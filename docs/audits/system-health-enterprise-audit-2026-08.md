# System Health Subsystem — Enterprise-Readiness Audit (2026-08-08)

Read-only adversarial audit of the **System Health** admin subsystem against six
enterprise skills: SRE / operational-readiness, release-deployment-safety,
comprehensive-test-strategy, enterprise-architecture-standards,
owasp-secure-coding-bdd, compliance-data-lifecycle. No files were changed.

Scope traced: `src/pages/SystemHealthPage.tsx`, `src/services/system-health.service.ts`
(+ `stats`/`error-reporter`), all `src/components/system-health/**` + admin tabs,
the health edge functions (`email-pipeline-health`, `reconcile-stuck-emails`,
`environment-readiness`, `auth-prober`, `edge-deploy-smoke`, `replay-email-dlq`/
`replay-dlq-emails`), `_shared/*`, the health RPCs + cron migrations, the test
tree, and CI gates.

---

## 1. The unifying root cause

The Lovable→owned-Supabase cutover (~2026-07, project `pzvqxdgoztbfikfuifix`)
ported **schema + data + edge-function code but not the imperative cron/infra**.
System Health is almost entirely a wall of **cron-fed stored aggregates**, so
every job that didn't make it into the portable recreation migration
(`20260707200000_recreate_cron_jobs_on_live_project.sql`) now renders a **frozen
card that looks healthy**. The subsystem meant to answer "how do we know if it
breaks?" cannot answer that question about itself: **the monitors' own liveness
is unmonitored, and the one readiness gate is too narrow to notice.**

Everything below is either a direct instance of that pattern or a structural
weakness that let it go undetected.

---

## 2. Cross-lens convergence (found independently by multiple auditors)

These are the highest-confidence findings — multiple lenses hit them separately.

| #   | Finding                                                                                                                                                                                                               | Lenses that flagged it                     |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| C1  | `reconcile-stuck-emails` cron never recreated post-cutover → 336 stuck emails, card frozen ~2mo                                                                                                                       | SRE, Release, Test, Enterprise, Compliance |
| C2  | `environment_readiness()` checks only 5 of ~20 crons; omits every dead one — and the daily `config-preflight.yml` gate inherits the hole                                                                              | SRE, Release, Test, Enterprise             |
| C3  | Alert **delivery path is dead**: `triage-critical-push` cron not recreated + `auth-prober` invokes a non-existent function + `edge-deploy-smoke` writes `audit_log` with **columns that don't exist** (insert throws) | SRE, OWASP, Enterprise                     |
| C4  | UI hardcodes "Reconciler runs every 5 min" / tones only on `stuck>0`; **staleness of `last_run_at` is never an alarm**                                                                                                | SRE, Test, Enterprise                      |
| C5  | Health RPCs `DISTINCT ON (message_id)` **full-scan `email_send_log` before windowing** — prior `statement_timeout` incident; won't survive 10k users                                                                  | Enterprise, Test                           |
| C6  | RPC↔service↔UI **shape drift** — `marked_dlq` vs `dlq_lost`, `requeued` not produced; papered over client-side; no contract test                                                                                      | Test, Enterprise                           |
| C7  | Other cutover-orphaned crons dead: retention (`enforce_retention_policy`, `purge_old_audit_logs`, `ops_events` expiry), `environment-readiness` never scheduled                                                       | Compliance, Enterprise, SRE                |
| C8  | Auth divergence across edge fns (one hand-rolled non-constant-time compare; 3 admin-auth idioms) + wildcard CORS                                                                                                      | OWASP, Enterprise                          |
| C9  | `VALID_HEALTH_TABS` allowlist drifts from rendered tabs → deep-links silently fall back to `queues`                                                                                                                   | SRE, Release, Enterprise                   |

---

## 3. Master findings — by severity

Severity is the max across lenses. **Layer** names where the fix belongs
(config/cron, DB, edge fn, UI, CI, docs). Evidence is `file:line`.

### P0 — Critical

**P0-1 · Reconciler cron missing (C1).** `cron.schedule('reconcile-stuck-emails', …)`
exists only in the pre-cutover `20260603134217_…sql:198-202`; the portable
recreation `20260707200000_…sql:47-198` omits it; no later migration schedules it.
`get_email_reconciler_status()` reads `ops_events` (`20260603205609_…sql:216-227`)
so `last_run_at` is frozen; `stuck_pending` is live so it correctly shows 336, but
nothing drains it. UI asserts the opposite at `SystemHealthPage.tsx:224`.
**Layer: DB/cron migration.** Add to the canonical registry, extension-guarded,
idempotent; call `reconcile_stuck_emails()` once in the migration body to drain
the backlog.

**P0-2 · Alert delivery path is dead (C3).** (a) `triage-critical-push` explicitly
not recreated (`20260707200000_…sql:24-27`); only ever `cron.alter_job … IF EXISTS`.
(b) `auth-prober/index.ts:198-207` invokes a function literally named
`"triage-critical-push"` which does not exist (the pager is `notify-critical-fix`);
failure swallowed. (c) `edge-deploy-smoke/index.ts:67-75` inserts `audit_log`
with `action`/`resource_type`/`resource_id`/`metadata` and a JSON `changed_fields`
— but the real schema is `event_type`/`table_name`/`record_id` + `changed_fields text[]`
(`20260315195132_…sql:3-12`), so the insert throws and the "edge function missing"
alarm never lands. **Net: synthetic probes record failures and page no one.**
**Layer: cron migration + edge fn.** Recreate the pager cron → `notify-critical-fix`;
fix `auth-prober`'s target; route `edge-deploy-smoke` through `write_audit_log`
(add a test asserting a row lands).

**P0-3 · Right-to-erasure not executable + conflicts with append-only audit (Compliance P0-1).**
`PrivacyRequestsTab.tsx:93-114` only sets status — no erasure executor RPC exists.
The only real deletion path, `handle_user_deletion` (`20260412203713_…sql:130,134`),
does `DELETE FROM audit_log` which the append-only trigger `trg_block_audit_mutation`
(`20260423204012_…sql:310-313`) rejects for **all** roles → the whole deletion
transaction rolls back (erasure silently impossible) **or** the trigger was dropped
(tamper-evidence broken). PII in `email_send_log`/`ops_events`/DLQ never propagates
regardless. **Layer: DB + service.** Pseudonymize `user_id` in `audit_log` instead
of deleting; build an anonymizing erasure executor across the PII tables; reconcile
the two triggers.

**P0-4 · `audit_log` has no working retention AND is sampled (Compliance P0-2).**
`purge_old_audit_logs` (`20260315195132_…sql:83-97`) is scheduled by no cron and
would be blocked by the append-only trigger anyway; meanwhile `_shared/audit.ts:83-103`
**drops** audit events under load (cap ×0.1 under "hard" pressure, `:46-53`).
Violates both storage-limitation and "audit logs must be complete, not sampled."
**Layer: DB + edge.** Split true compliance-audit events from operational telemetry
(route the latter to `ops_events`); never sample the audit tier; enforce a real,
audited retention path through the guard.

> Note: whether P0-1/P0-2's _sibling_ crons are also dead needs the live
> `cron.job` inventory — run `_diag_syshealth.mjs` (§6).

### P1 — High

**P1-1 · Readiness gate + drift CI cover ~25% of crons (C2).**
`environment_readiness()` checks a hardcoded 5-job list (`20260708030000_…sql:91-97`);
its failing-run section only flags jobs that _ran and failed_ in 2 days, so a
never-scheduled job is invisible twice over. The daily `config-preflight.yml:70-83`
gate runs this RPC, so the CI drift-detector structurally **cannot** catch C1.
**Layer: DB + CI.** Drive the critical-cron list from a single declared registry
(diff `cron.job` against expected-set); add "last run older than N× interval" check.

**P1-2 · No SLIs/SLOs/error budgets anywhere (SRE P1-1).** Health is categorical
prose (`system-health.service.ts:73-89`); "failure rate" is an instantaneous
windowed ratio never compared to a target (`SystemHealthPage.tsx:134-137`). No
rolling window, no burn-rate. Team epic marks member-facing SLOs as not-done.
**Layer: DB + config.** Define 4–5 SLIs (login success, reset-email delivery,
app-load success, pipeline freshness, p95) on the `ops_events` spine; derive
burn-rate alerts feeding the repaired pager.

**P1-3 · Health RPCs full-scan `email_send_log` before windowing (C5).**
`get_email_pipeline_health` (`20260518212451_…sql:16-33`), `reconcile_stuck_emails`
(`20260603205609_…sql:33-42`), `get_email_reconciler_status` (`…:205-210`) all
`DISTINCT ON (message_id)` over the whole append-only table, then window downstream;
the `p_hours` filter never reaches the base scan. Every 5-min poll per admin
triggers an O(total-rows) sort. `environment_readiness` already hit
`statement_timeout` once for the same reason (`20260708030000_…sql:110-114`).
**Layer: DB.** Push the time predicate into the base CTE; add `(message_id,
created_at DESC)` + partial `status='pending'` indexes; consider a materialized
`email_send_log_latest` read-model.

**P1-4 · `run_auto_remediations()` callable by any authenticated user (OWASP P1).**
`SECURITY DEFINER`, no `has_role` gate, `GRANT EXECUTE TO authenticated`
(`20260418201529_…sql:241-329`). Any of ~767 users can trigger the self-healing
engine on demand (state changes + audit noise / cost DoS). **Layer: DB.** Add an
admin/service-role guard in the body; `REVOKE … FROM authenticated`. _(Run the
lockout/accidental-deletion safety check before revoking — confirm the cron caller
is service-role and an admin path remains.)_

**P1-5 · Retention engine dead post-cutover (C7 / Compliance P1-1).**
`enforce_retention_policy` (ledger purge + web-vitals/network anonymization,
`20260507035848_…sql:168-179`) and `ops_events` 90-day expiry
(`20260602230329_…sql:22-37`) were scheduled only pre-cutover; no cron runs them.
Restricted PII accumulates unbounded. `20260729180000_cron_history_retention.sql`
is the correct portable template. **Layer: DB/cron migration.**

**P1-6 · Retention/incident audit events silently never written (Compliance P1-2).**
`enforce_retention_policy` (`20260507035848_…sql:75-80`) and `open_incident`
(`…:123-125`) INSERT into nonexistent `audit_log` columns (`actor_id`/`target_type`/
`payload`), wrapped in `EXCEPTION WHEN OTHERS THEN NULL` → control-evidence events
raise `undefined_column` and vanish. **Layer: DB.** Use `write_audit_log`; stop
swallowing audit-write errors for control events.

**P1-7 · Unmasked recipient PII in admin UI + `email_send_log` no retention (Compliance P1-3).**
Full addresses rendered at `SystemHealthPage.tsx:90`, `EmailDlqPanel.tsx:116,331`;
no masking, no read-audit; `email_send_log` (`20260316051305_…sql:27-36`) has no
TTL (the `email_send_state` TTL columns are queue timeouts, not log retention).
**Layer: DB view/RPC + UI + retention job.** Mask by default; gate full reveal
behind an audited action.

**P1-8 · No backup / DR / RPO-RTO for audit + PII data (Compliance P1-4).**
No PITR/backup/RPO/RTO config in-repo post-cutover. The immutable hash-chained
`audit_log` is only tamper-evident _within_ the DB — no evidenced, restore-tested
backup. **Layer: infra/SRE.** Confirm PITR; set RPO/RTO; schedule a restore drill.

**P1-9 · Migration replay is broken: infra referenced before it exists (Release P0-2).**
`20260707200000` (reads `cron.job`, `pgmq.*`, `net.http_post`) is timestamped
_before_ the extensions/queues IaC `20260708040000`, and documents a manual
"run `CREATE EXTENSION pg_cron` by hand first" step (`:29-35`). A clean
`supabase db reset` cannot reproduce the environment. **Layer: migration ordering.**
Re-order base-infra first; guard every cron migration with `pg_extension` check;
delete the manual prerequisite.

**P1-10 · Dual email deploy paths; replay resurrects the retired one (Release P0-3).**
`pipeline_v2_lanes_bitmask=7` routes all lanes to v2 (`20260707210000_…sql:56`),
but the registry unconditionally recreates the legacy `process-email-queue` cron
(`20260707200000_…sql:52-71`); retiring it is a manual runbook step, so any replay
re-creates it (double-send risk). **Layer: migration + flag.** Make the contraction
a migration; stop recreating the legacy job.

**P1-11 · Test strategy is an "ice-cream cone" of source-string asserts (Test P0-2/P0-3, P1-3/4/5).**
`email-reconciliation.smoke.test.ts` only greps repo files (passes while the cron
is absent — "encodes the bug as correct"); `SystemHealthPage.test.tsx:51-56` mocks
only the green reconciler state; no pgTAP for the health backend and `db-test` is
non-blocking (`ci.yml:399-430`); no contract tests (C6 drift undetected); the
watchdog "regression" test asserts a toy reimplementation
(`email-pipeline-watchdog.test.ts:7-38`). **Layer: CI/test.** Real integration +
pgTAP asserting cron scheduled/active; contract tests on RPC jsonb shapes; promote
`db-test` to the gate.

### P2 — Medium

- **P2-1 · `get_email_reconciler_status()` leaks ops data to all authenticated users (OWASP P2).** No admin gate, `GRANT … authenticated` (`20260603205609_…sql:198-232`); diverges from the gated `get_email_pipeline_health`. **DB.**
- **P2-2 · `write_audit_log` GRANTed to `authenticated` → Top-Errors injection (OWASP P2).** Any user can insert `*_pipeline_unhealthy` rows surfaced by `get_top_error_fingerprints` even with NULL message; permanent (append-only). **DB.**
- **P2-3 · No single source of truth for "health" (Enterprise P1-3).** Status computed in the RPC _and_ stored in `system_health_state.status`; UI trusts RPC, ignores the row; `email-pipeline-health` overloads `system_health_state.metadata` with audit-pressure. **DB/service + ADR.**
- **P2-4 · `SystemHealthPage.tsx` is a 23-tab god component (Enterprise P1-2).** ~15 bounded contexts in one ~391-line file. **UI routing** — lazy per-context modules.
- **P2-5 · Probes lack timeouts / circuit breakers (Enterprise P2-3).** `auth-prober` `fetch` has no `AbortSignal`; `email-pipeline-health` RPCs untimed; `edge-deploy-smoke` does it right — apply uniformly via shared `fetchWithTimeout`. **edge fn/\_shared.**
- **P2-6 · Duplicated/inconsistent auth + wildcard CORS (C8).** `email-pipeline-health` hand-rolls a non-constant-time `!==` (`:46-53`) vs shared `timingSafeEqualStr`; 3 admin-auth idioms; `Access-Control-Allow-Origin:*` on health fns. **\_shared consolidation.**
- **P2-7 · Two overlapping DLQ-replay functions; one mis-tagged (Enterprise P2-2).** `replay-email-dlq` (cron, real) vs `replay-dlq-emails` (admin-JWT, tagged `@edge-cron` but can't be cron-invoked). **Rename + fix manifest tag.**
- **P2-8 · No load/perf, chaos, coverage, or mutation gates (Test P2-1/2/3/4).** No perf baseline on the full-scan RPCs; no fault-injection; `vitest.config.ts` has no coverage thresholds; drift gates run daily and self-skip green instead of blocking. **CI.**
- **P2-9 · `ops_events` expiry decorative; `verify_audit_chain()` never run; service-role `write_audit_log` trusts caller `user_id` (Compliance P2-1/2/3).** **DB + SRE schedule.**
- **P2-10 · Self-healing + watchdog restored but unmonitored; watchdog pages only to one optional Discord webhook with silent-null fallback (SRE P2-1).** Add to readiness registry; verify `discord_alert_webhook`; second channel. **DB + config.**

### P3 — Low / hygiene

- **P3-1 · `VALID_HEALTH_TABS` drift (C9)** — `SystemHealthPage.tsx:376` omits `reset`/`auth-funnel`/`edge-functions`/`blasts`/`email-v2`/`deliverability`; deep-links fall back to `queues`. Derive from one tab registry.
- **P3-2 · Hardcoded project URL/domains** — `20260707200000_…sql:39`, `replay-dlq-emails/index.ts:147,443`. Source from Vault/env.
- **P3-3 · `generatedAt` client-clock fallback** (`SystemHealthPage.tsx:139`) can render "Updated just now" on a stale/failed snapshot.
- **P3-4 · No correlation-ID trace across the email pipeline** (prober has one; not threaded enqueue→dispatch→send_log).
- **P3-5 · Reconciler not idempotent under concurrent runs** (`20260603205609_…sql:63-174`) — a manual "run now" during the scheduled run could double-append terminal rows.
- **P3-6 · Incident-response assets thin** — Incidents tab + table exist but no SEV levels / on-call / postmortem template. Runbooks exist but aren't linked from alerts/cards.
- **P3-7 · DSAR intake has no notification/SLA alert** (`dsar-submit/index.ts:62-64`) — 30-day SLA depends on an admin watching the tab.
- **P3-8 · Stale auth comments** in `auth-prober`/`reconcile-stuck-emails` claim a JWT path the shared helper no longer accepts.

---

## 4. Deprecation candidates (confirm before deleting)

The owner noted "some things are not necessary anymore." Candidates surfaced by the audit — **confirm against the live diagnostic before removing:**

- **`process-email-queue`** legacy Lovable worker — superseded by v2 Resend dispatcher (`pipeline_v2_lanes_bitmask=7`); runbook already says to unschedule it (P1-10).
- **`replay-dlq-emails`** (vs `replay-email-dlq`) — overlapping; verify which is live and retire/rename the other (P2-7).
- **Tabs backed by dead/retired features** — the live cron + table-freshness diagnostic (§6) will show which tabs render permanently-stale data; those are prune-or-fix decisions (e.g. anything tied to Lovable-era features).
- **Stale auth JWT-path comments / the hand-rolled `email-pipeline-health` auth** — consolidate to the shared helper (P2-6, P3-8).

---

## 5. Proposed fix plan (sequenced)

**Wave 0 — Stop the bleeding + restore alarms (P0).** _These are the fixes that make the dashboard tell the truth again._

1. Portable migration: schedule `reconcile-stuck-emails` (+ drain the 336) and re-order so infra/extensions sort first (P0-1, P1-9).
2. Repair the pager: recreate `triage-critical-push`→`notify-critical-fix`, fix `auth-prober`'s target, route `edge-deploy-smoke` through `write_audit_log` (P0-2).
3. Make `environment_readiness()` + `config-preflight.yml` cover **all** critical crons, driven from one declared registry, with a staleness check (P1-1) — this is the guard that prevents recurrence.
4. Add a cron-liveness/staleness alarm and drive the reconciler card tone off `last_run_at` age (C4).

**Wave 1 — Security + compliance P0/P1.** 5. Lock down `run_auto_remediations`, `get_email_reconciler_status`, `write_audit_log` GRANTs (P1-4, P2-1, P2-2). _(Run the lockout safety check.)_ 6. Erasure executor + audit-retention split + reconcile append-only vs cascade (P0-3, P0-4). 7. Re-schedule retention/expiry crons; fix the broken control-evidence audit inserts (P1-5, P1-6). 8. Mask recipient PII; add `email_send_log` retention (P1-7). Define backup/RPO-RTO + restore drill (P1-8).

**Wave 2 — Reliability + scale.** 9. Fix full-scan RPCs (predicate pushdown + indexes / read-model) (P1-3). 10. Define SLIs/SLOs/error budgets on the `ops_events` spine; burn-rate alerts (P1-2). 11. Timeouts/circuit breakers, auth consolidation, CORS, single health source-of-truth (P2-3/5/6).

**Wave 3 — Test/CI hardening + hygiene.** 12. Replace string-grep smoke with real integration + pgTAP (cron scheduled/active); contract tests for RPC shapes (C6); promote `db-test` to blocking; coverage/perf/chaos gates (P1-11, P2-8). 13. Surface `environment_readiness` as a Readiness tab; tab-registry dedup; deprecation removals (P3s).

**Sequencing rationale:** Wave 0 first because _alerting delivery + the readiness
guard gate everything else_ — there's no point defining SLOs (Wave 2) if the pager
they'd feed is dead. Each wave is independently shippable behind the expand/contract

- idempotent-migration discipline in `release-deployment-safety`.

---

## 6. Ground truth still needed

Findings above are repo-provable **except which _other_ crons are dead** — that
requires the live `cron.job` inventory. Run the read-only diagnostic (repo root):

```
$env:PGPASSWORD="<db password>"; $env:CA_PATH="prod-ca-2021.crt"; node _diag_syshealth.mjs
```

It dumps every cron job + last-run status + table freshness + queue depths, which
finalizes the per-card "dead vs. deprecated vs. working" matrix and confirms the
deprecation candidates in §4.
