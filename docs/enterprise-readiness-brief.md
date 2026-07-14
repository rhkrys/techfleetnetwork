# TechFleet Network — Enterprise-Readiness Brief (input for a PRD)

**Purpose of this document.** This is a _briefing package_, not a PRD. Hand it to Claude
Cowork (or any planning agent) with the instruction: **"Turn this into a PRD + BDD in the
same style as `docs/baseline-restoration-prd.md`."** It is fully self-contained — all
evidence is embedded, so the reader needs no prior conversation and no database access.

**Authored:** 2026-07-08 by Claude Code, from direct, TLS-verified queries against the live
production database plus a 14-day activity-log audit. Every number below is real and
reproducible (see the reproduction recipe in Appendix C).

---

## 0. Instruction to the PRD author (Cowork)

Produce a PRD titled **"Enterprise Readiness — PRD + BDD"** that takes TechFleet Network from
its current _stabilized_ state (~767 users, just recovered from a Supabase migration) to
**enterprise-grade: scalable to 100,000 users, fail-proof, bug-free, OWASP-compliant, and
cost/performance-efficient.**

Requirements for the PRD you generate:

1. Keep the house format: root-cause/theme classes → numbered in-scope items with IDs →
   BDD (`Given/When/Then`) acceptance criteria per item → out-of-scope → open decisions.
2. Group work under the **five pillars** in §4. Give every requirement an ID (e.g.
   `SCALE-1`, `REL-3`, `SEC-2`, `PERF-4`, `QUAL-1`).
3. For each requirement include: the layer (UI / state / data / auth / API / DB / infra),
   the evidence it's based on (cite the §/appendix here), acceptance criteria, and a rough
   size (S/M/L).
4. Honor the project's prime directives (see §5): fix config in config, never weaken
   auth/RLS/validation, smallest change that solves it, prove every fix.
5. Sequence into P0/P1/P2 waves with a suggested order and rough effort.
6. Explicitly separate **"already done, keep/verify"** from **"new work."** Do not re-litigate
   fixes that §2 proves are complete.

---

## 1. System overview

- **Frontend:** Vite + TypeScript + React + shadcn/ui + Tailwind (v3.4.17). Static `dist/`
  served by Cloudflare Pages (git-integration deploy). No production Node server.
- **Backend:** Supabase — Postgres 17.6, PostgREST, GoTrue auth, RLS, ~114 edge functions
  (Deno). Project ref `pzvqxdgoztbfikfuifix`.
- **Async infra:** pg_cron + pg_net + pgmq queues; a v2 email pipeline (Outbox →
  `email-dispatcher` → Resend).
- **Scale today:** ~767 real users. **Target: 100,000** (≈130× growth).
- **History that matters:** the app was built on Lovable and recently cut over to a
  self-owned Supabase project. **Only schema + data + edge-function code migrated; imperative
  infra (extensions, cron jobs, pgmq queues, Vault secrets, schema grants) did not.** That
  single fact is the root of most of the incidents in §2. The migration is stabilized but the
  migration _ledger_ is still empty (see §3, REL gap).

---

## 2. What has already been fixed — with proof

All evidence captured **2026-07-08T15:49:19Z** against the live DB (`postgres`, PostgreSQL
17.6) over a CA-verified TLS connection (pooler `aws-1-us-east-1.pooler.supabase.com:5432`).

### 2.1 Admin access / recruiting center (was: status-change 403 + recurring RLS errors)

**Root cause (data/auth layer):** `public.has_role()` delegates to `private.has_role()`.
After cutover the app roles lost `USAGE` on schema `private`, so every call through the
SECURITY-DEFINER wrapper failed with `permission denied for schema private`. Symptom:
`notify-applicant-status` swallowed the RPC error → treated a real admin as non-admin → **403**.

**Fix:** restored grants (`GRANT USAGE ON SCHEMA private …` + `EXECUTE` + default privileges).

**PROOF (live):**

```
private_schema_usage:
  anon           has_usage = true
  authenticated  has_usage = true
  service_role   has_usage = true

admin_has_role (evaluated under SET ROLE service_role — the exact path the edge fn uses):
  12d1a973-…-49ae8f55371b   has_role_admin = true
  3c77508b-…-83fec059c11f   has_role_admin = true
  52ffef70-…-f7ead4ac82c2   has_role_admin = true
  9d6e7354-…-19bed565bb73   has_role_admin = true
  admin_count = 4    admins_all_true = true
```

Every one of the 4 admins in the database evaluates `has_role('admin') = true`. No loss of
coverage.

**PROOF the RLS policies admins need also exist:**

```
project_applications: SELECT/UPDATE/DELETE "Admins can …"  (+ user-scoped policies)
general_applications: SELECT "Admins can view all …"       (+ user-scoped policies)
```

### 2.2 Email pipeline (was: nothing sent — signups/resets/confirmations silently dead)

**Root cause (infra/config layer):** cascade of un-migrated infra — pg_cron not enabled,
missing pgmq queues (`q_auth_emails`/`q_bulk_emails`), cron rows pointing at the dead
project, the legacy worker calling Lovable (`LOVABLE_API_KEY` unset → "Server configuration
error"), and a wrong service-role key in Vault. Cut over to the **Resend v2** pipeline.

**PROOF (live):**

```
email_send_state.pipeline_v2_lanes_bitmask = 7   (all lanes → Outbox → Resend)
pgmq queues present: auth_emails, bulk_emails, transactional_emails
vault secrets present: email_queue_service_role_key (has_value=true), project_url (has_value=true)
email_outbox (last 14 days):  status=sent  n=16   last_created 2026-07-08T15:00:02Z
  → 0 failed, 0 pending, 0 stuck; most recent send was today
```

### 2.3 Cron / background jobs (was: dead-host jobs, silent no-ops)

**PROOF (live) — 10 jobs, all active, ZERO failures in the last 24h:**

```
jobid schedule       active jobname
 2    */5 * * * *     true  app-confirmation-sweeper
 3    */5 * * * *     true  replay-email-dlq-every-5min
 4    0 15 * * *      true  triage-digest-daily
 5    */15 * * * *    true  email-pipeline-health-every-15m
 6    */10 * * * *    true  refresh-community-events
 7    30 seconds      true  prewarm-ugc-worker-every-30s
 8    15 seconds      true  process-freescout-events-every-15s
 9    */10 * * * *    true  edge-deploy-smoke-10min
 10   */5 * * * *     true  auth-prober-5min
 11   30 seconds      true  email-dispatcher-v2
cron_recent_failures (24h, status <> succeeded): []   ← empty
```

(Note for the PRD: jobs 7/8/11 poll every 15–30s. That is fine at 767 users but is a
cost/scale item at 100k — see PERF in §4.)

### 2.4 Deploy pipeline (was: 11-day silent freeze — prod stuck on an old bundle)

**Root cause (infra layer):** a stray `bun.lock` made Cloudflare build with bun, which can't
parse `package.json` nested `overrides`; then a Tailwind v4/v3 PostCSS mismatch. Both builds
failed **silently** — the dashboard showed no error and prod kept serving the old bundle.
**Fix:** removed `bun.lock` (npm is canonical), pinned Tailwind to 3.4.17. New bundle hashes
now ship. (Evidence: the captcha fix and all subsequent changes are live.)

### 2.5 Captcha / signup (was: Brave & all browsers → 403 "human verification failed")

**Root cause (state layer):** the register Turnstile widget never called
`markLoginCaptchaVerified()`, so a client-side throttle gate blocked the signup POST with a
~12 ms 403 _before any server request_. **Fix:** `TurnstileChallenge.tsx` now clears the
throttle flag on successful verification for all actions, not just login. Repro test added
(`src/test/ui/TurnstileChallenge.register-captcha-gate.test.tsx`) — fails before, passes after.

### 2.6 Observability (new capability landed)

`public.environment_readiness()` deploys as an **admin-only** health probe.

**PROOF it's deployed AND its guard works:** calling it as a non-admin superuser role raised
`ERROR: admin role required` — i.e. the function exists and correctly refuses non-admins.

### 2.7 The "only 100 activity-log records" worry — disproven

The dashboard's count was reading a **stale `reltuples` estimate**, not reality. Direct count:

```
audit_log rows in last 14 days = 1,214   (not ~100)
```

Logging works fine. (A fast-exact-count RPC replaced the stale estimate.)

---

## 3. Activity-log audit (last 14 days) — evidence for what's LEFT

Direct query of `audit_log`, 14-day window, 1,214 total events.

**Error classes, with last-seen timestamps (proof they stopped as fixes landed):**

| Error class                                           | Count (14d) | Last seen  | Status                               |
| ----------------------------------------------------- | ----------- | ---------- | ------------------------------------ |
| `Edge Function returned a non-2xx`                    | 175         | 2026-07-01 | fixed (fns deployed)                 |
| `Discord bot configuration is missing`                | 107         | 2026-07-01 | fixed (secrets set)                  |
| `Failed to send a request to the Edge Function`       | 57          | 2026-07-06 | fixed (deploy + cap)                 |
| `permission denied for schema private`                | 42          | 2026-06-25 | fixed (grants, §2.1)                 |
| `freescout-proxy … invoke_error`                      | 29          | 2026-07-06 | **OPEN — needs `FREESCOUT_API_KEY`** |
| `NotFoundError: Row not found`                        | 6           | 2026-07-08 | minor — investigate                  |
| `NetworkError: loading dynamically imported module …` | 1           | 2026-07-08 | post-deploy stale-chunk; UX item     |
| `Server configuration error`                          | 0           | —          | fixed                                |
| `statement timeout`                                   | 0           | —          | fixed                                |

**UX / repeated-actions findings:**

- Task completions are idempotent — only **1** duplicate pair in 14 days.
- The real "repeated action" signal is **users retrying broken features**: individual users
  fired `edge_invoke_failed` up to **17×** and `client_error` 20–35× during the outages. Root
  causes are fixed; expect these retry storms to disappear. A **"new version available —
  refresh"** banner would kill the post-deploy stale-chunk retries.

**Still genuinely open from the audit:**

1. `freescout-proxy` (support desk) — 29 failures; needs `FREESCOUT_API_KEY` set (config only).
2. Stale-chunk NetworkError after deploys — needs a refresh-prompt UX.
3. `NotFoundError: Row not found` (6) — low volume; confirm it's benign.

---

## 4. The five enterprise-readiness pillars (the PRD's backbone)

Each pillar below states the **goal**, the **evidence** from this codebase, and **candidate
requirements**. The PRD author should convert candidates into ID'd requirements with BDD.

### Pillar A — Reliability & "fail-proof" _(prefix `REL`)_

**The #1 lesson of the migration: every outage was a silent, non-reproducible config gap, not
a code bug.** Enterprise reliability here means making silence impossible and infra reproducible.

- **REL — Alerting on the silent probes.** `edge-deploy-smoke`, `email-pipeline-health`,
  and `auth-prober` cron jobs already run (proof: §2.3) but only _record_ — they don't _page_.
  Wire them to a real alert channel (email/Discord/PagerDuty) with thresholds.
- **REL — System Health surface.** Wire `environment_readiness()` (§2.6) into an admin panel
  so config drift is visible before it becomes an outage. Add an admin-coverage assertion.
- **REL — Reproducible infra (IaC) + migration-ledger repair.** The ledger is **empty**, so
  `supabase db push` is unsafe and environments drift. Requires a careful audit (some
  migrations — e.g. `fleety_rearchitecture` — are genuinely unapplied and must NOT be marked
  applied). This is the durable fix for "the migration keeps biting us."
- **REL — Deploy visibility.** Activate the visible-deploy CI workflow (needs Cloudflare
  secrets) so a failed build is a red check, never an 11-day silent freeze (§2.4).
- **REL — DR.** Confirm PITR is enabled and _test a restore_; write a DR runbook.
- **REL — Config-as-code + secrets inventory.** Every `Deno.env.get` across ~114 functions
  inventoried, with presence checks and rotation policy. (The open `FREESCOUT_API_KEY` in §3
  is a live example of the gap.)

### Pillar B — Scalability to 100,000 users _(prefix `SCALE`)_

- **SCALE — Cron → event-driven.** Jobs poll every 15–30s (proof: §2.3, jobs 7/8/11). At
  100k users that's ~15k+ invocations/day doing nothing when idle. Move to NOTIFY/trigger-
  driven (the v2 email path already has the trigger); back crons to a 1-min safety net.
- **SCALE — Frontend bundle.** Main bundle ~800 KB + ag-grid ~880 KB + chart/jspdf ~390 KB
  chunks. Code-split behind dynamic imports; enforce the existing ~350 KB size-limit gate.
- **SCALE — DB hot paths.** Generalize the fast-exact-count pattern (§2.7); audit for N+1s,
  full-table counts, and missing indexes; confirm pooler/compute sizing and consider read
  replicas for heavy read paths.
- **SCALE — Rate-limit & quota review** at 130× load (per-IP/email limits already exist).

### Pillar C — Security / OWASP _(prefix `SEC`)_

**Architecture is already strong; the weak spot is A05 Misconfiguration (the whole migration
saga).** Evidence-backed posture:

- **A01 Access Control — strong.** RLS coverage is **178/178 public tables** (proof: live
  `rls_coverage rls_on=178 total=178`, `tables_without_rls=[]`). Requirement: a standing
  test that fails CI if any new table ships without RLS.
- **A05 Misconfiguration — the priority.** Secrets/grants/config silently missing caused every
  §2 incident. Requirement: config-as-code + readiness gates + secrets inventory/rotation.
- **A06 Vulnerable Components.** The build flags npm vulnerabilities (reported 1 high +
  several moderate). Requirement: triage the high, keep Dependabot green.
- **A09 Logging/Monitoring.** `audit_log` + client error reporting exist but probes were
  silent — same fix as REL alerting.
- **A03 Injection — strong** (WAF on public fns, zod validation, client input firewall;
  evidence: audit log shows an XSS-y LinkedIn URL was rejected by `profileSchema`). **A07
  Auth — strong** (MFA/aal2, Turnstile, lockout, auth-broker, frozen auth layer).
- Requirement: a formal **OWASP ASVS pass** + `/security-review` on every release diff.

### Pillar D — Bug-free (as achievable) _(prefix `QUAL`)_

- **QUAL — Fix flaky CI gate.** The gate tests have time/order-dependent failures
  (session-reset, google-sign-in, throttle-dedupe) that fail intermittently on a clean tree.
  Flaky tests train everyone to ignore red. Make them deterministic (injected clock, isolation).
- **QUAL — Keep the frozen-auth regression suite green;** extend contract tests to more
  edge functions.
- **QUAL — Config-correctness tests** (readiness assertions in CI), since most real bugs here
  are config drift, not logic errors.

### Pillar E — Performance & cost _(prefix `PERF`)_

- **PERF — Cron cost** (same lever as SCALE cron→event-driven; call out the $ impact).
- **PERF — Bundle/CDN** (code-splitting + CDN caching on public endpoints; several already
  use ETag/SWR — generalize).
- **PERF — DB efficiency** (fast-count pattern generalized; index audit).
- **PERF — Billing budgets + alerts** (the project already runs a deliberate ~$25/mo cap;
  formalize budget alarms).

---

## 5. Non-negotiable constraints the PRD must honor (from CLAUDE.md)

1. Never claim a change that wasn't made; prove every fix with a repro that failed before /
   passes after.
2. **Fix config problems in config** (Nginx/DNS/CDN/CI/DB), not with client-side band-aids —
   and delete the band-aid when the real fix lands.
3. **Auth is frozen.** Do not touch `client.ts`, the `main.tsx` boot block, `src/lib/auth/**`,
   `src/features/auth/**`, or sign-in/up/reset/MFA UI without the full auth regression suite
   green. Exactly ONE Supabase client instance, ever.
4. Never weaken auth, RLS, validation, or types to make something pass.
5. Smallest change that fully solves it; no drive-by rewrites or new deps without justification.
6. Definition of Done: root cause + layer named; repro proves it; `npm run test` + typecheck +
   lint green; only necessary files changed; security not weakened; summary = cause → change → proof.

---

## Appendix A — Suggested PRD skeleton (fill this in)

```
# Enterprise Readiness — PRD + BDD (v0.1 draft)
Status / Goal / Theme
1. Pillars & requirement IDs (A/REL, B/SCALE, C/SEC, D/QUAL, E/PERF)
2. In scope — per requirement: {id, layer, evidence ref, description, BDD, size}
3. Already done — keep/verify (from §2; do not redo)
4. Out of scope
5. Open decisions (e.g. ledger-repair strategy; alert channel; read-replica trigger point)
6. Sequencing: P0 (REL alerting, deploy visibility, ledger repair, flaky tests, npm-high) →
   P1 (cron→event, bundle split, DB audit, secrets inventory) → P2 (ASVS, DR test, refresh UX)
```

## Appendix B — Current verified state (copy of the raw evidence, 2026-07-08T15:49:19Z)

- DB: PostgreSQL 17.6; captured over CA-verified TLS.
- `private` USAGE: anon/authenticated/service_role all true.
- Admins: 4/4 `has_role('admin')=true`.
- Cron: 10 jobs active; 24h failures = 0.
- pgmq queues: auth_emails, bulk_emails, transactional_emails.
- Vault: email_queue_service_role_key (set), project_url (set).
- Email: bitmask=7; outbox 14d = 16 sent / 0 failed / 0 pending; last 2026-07-08T15:00Z.
- RLS: 178/178 public tables enabled; 0 without.
- audit_log 14d: 1,214 rows. Open error classes: freescout (29), NotFoundError (6),
  stale-chunk NetworkError (1). All fixed classes last-seen Jun 25–Jul 6.
- `environment_readiness()` deployed; admin guard enforced.

## Appendix C — How to reproduce the evidence (for auditors)

Connect with a Postgres client over verified TLS (Supabase CA cert `prod-ca-2021.crt`):

```
host=aws-1-us-east-1.pooler.supabase.com port=5432
user=postgres.pzvqxdgoztbfikfuifix  db=postgres
ssl: { ca: <prod-ca-2021.crt>, rejectUnauthorized: true }
```

Key queries:

```sql
-- private grants
SELECT rolname, has_schema_privilege(rolname,'private','USAGE')
FROM pg_roles WHERE rolname IN ('authenticated','anon','service_role');
-- admin coverage (run under: SET ROLE service_role;)
SELECT user_id, public.has_role(user_id,'admin'::public.app_role)
FROM public.user_roles WHERE role='admin';
-- cron health
SELECT jobid, schedule, active, jobname FROM cron.job ORDER BY jobid;
SELECT j.jobname, d.status, count(*) FROM cron.job_run_details d
  JOIN cron.job j USING (jobid)
  WHERE d.start_time > now()-interval '24 hours' AND d.status<>'succeeded'
  GROUP BY 1,2;
-- email
SELECT pipeline_v2_lanes_bitmask FROM email_send_state;
SELECT status, count(*), max(created_at) FROM email_outbox
  WHERE created_at > now()-interval '14 days' GROUP BY 1;
-- RLS coverage
SELECT count(*) FILTER (WHERE relrowsecurity), count(*) FROM pg_class c
  JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND relkind='r';
-- activity-log error classes
SELECT split_part(error_message,E'\n',1), count(*), max(created_at) FROM audit_log
  WHERE created_at > now()-interval '14 days' AND coalesce(error_message,'')<>''
  GROUP BY 1 ORDER BY 2 DESC;
```

```

```
