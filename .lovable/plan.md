## Why refactor (not patch again)

The email subsystem has grown to **28 edge functions, a 732-line `process-email-queue`, a 571-line `transactional-email` helper, 30+ patch migrations, 3 pgmq queues, 2 throttle tables, and 6 cron jobs**. Each incident has added another knob (workspace token bucket, per-lane cooldown, frequency cap, bulk-paused flag, workspace-quota cap, resume button…). The knobs interact in ways no one document captures, so every new failure mode requires another patch. That's the smell.

This plan replaces the surface area with a **clean four-layer architecture**, a **single Outbox**, and a **single Scheduler with policy plug-ins** — the way Stripe, Shopify, and Twilio run their notification systems.

---

## Target architecture

```text
┌─────────────────────────────────────────────────────────────────────┐
│ Interface layer                                                     │
│   • HTTP edge fns (thin) — auth-email-hook, send-announcement-email │
│   • Admin console (System Health → Email v2)                        │
│   • Cron (pg_cron) — drains queues, runs reconcilers                │
└──────────────┬──────────────────────────────────────────────────────┘
               │ commands / queries
┌──────────────▼──────────────────────────────────────────────────────┐
│ Application layer (use-cases, transaction script per command)       │
│   EnqueueEmail · DispatchDue · HandleProviderResult · ReplayDlq     │
│   PauseLane · ResumeLane · ExpireStalePending · GcRetention         │
└──────────────┬──────────────────────────────────────────────────────┘
               │ ports (interfaces)
┌──────────────▼──────────────────────────────────────────────────────┐
│ Domain layer (pure, no I/O)                                         │
│   Aggregates:  Email · Lane · ThrottlePolicy · Suppression          │
│   Value objs:  Recipient · Template · Lane(auth|tx|bulk)            │
│                ProviderResult · BackoffDecision · Idempotency       │
│   Policies:    LaneRouter · BackoffStrategy · FairnessGuard         │
│                FrequencyCap · SuppressionGate                       │
└──────────────┬──────────────────────────────────────────────────────┘
               │ implemented by
┌──────────────▼──────────────────────────────────────────────────────┐
│ Infrastructure layer                                                │
│   OutboxRepo (pg)      ProviderPort (Lovable Emails today,          │
│   SuppressionRepo (pg)   Resend/SES tomorrow — swap one file)       │
│   ThrottleRepo (pg)    Clock · Logger · Tracer · MetricSink         │
└─────────────────────────────────────────────────────────────────────┘
```

### Single Outbox (replaces 3 pgmq queues + log + state mash-up)

One canonical table `email_outbox(id, lane, template, recipient, payload, idempotency_key, status, attempts, next_attempt_at, last_error, dlq_reason, created_at, sent_at, dlq_at, run_id)` with status `pending → sending → sent | dlq | suppressed | expired`. The Scheduler claims `(status='pending' AND next_attempt_at<=now())` rows with `FOR UPDATE SKIP LOCKED` — no pgmq, no visibility-timeout footguns, no parallel "lanes vs queues" mental model. Lane is just a column the Scheduler reads.

`email_send_log` becomes a **view** over `email_outbox` for backward compat; the existing 1,845 legacy `pending` rows are migrated and aged-out by the new `ExpireStalePending` job in one shot.

### Adaptive Scheduler with policy plug-ins

A single SECURITY-DEFINER RPC `claim_due_emails(p_now, p_max)` returns a fair, throttle-aware batch — auth first, transactional second, bulk last, subject to:

1. `FairnessGuard` — bulk may not consume the last workspace token while auth/tx have work waiting.
2. `BackoffStrategy.next(attempt, providerHint, recent429s)` — pure function; replaces 4 scattered `Math.max/min` blocks.
3. `FrequencyCap.check(recipient, lane, template, window)` — already designed, moved into domain.
4. `SuppressionGate.check(recipient)` — pre-claim filter.
5. `CircuitBreaker.permit(lane)` — opens on 3 workspace-quota 429s in 10 min, half-opens after a probe interval, closes on 5 successes. **Replaces the bulk_paused flag + the lane cooldown + the 120-s cap.**

All five policies are pure TS in the domain layer, contract-tested without DB or network — every "knob" becomes a tunable in a single `EmailPolicyConfig` row.

### Provider port

`ProviderPort.send(EmailEnvelope) → ProviderResult` is the only I/O boundary. Today: `LovableEmailsProvider`. Adding Resend/SES tomorrow = one file, no behavior change anywhere else.

### Observability built in, not bolted on

- One emitter `EmailEventSink.emit(kind, payload, severity)` → `ops_events` (telemetry, 90-day TTL) **and** `audit_log` (compliance) per the existing tri-partite contract.
- Per-event OpenTelemetry-style trace: `enqueue → claim → send → result` linked by `idempotency_key`.
- `ops_metrics` daily rollup: sent / dlq / rate_limited / circuit_open_seconds per lane.

### Operator console (System Health → Email v2)

One screen replacing the scattered cards. Real-time view of every lane's: circuit state, queue depth, p50/p95 attempt latency, last 50 events, top 5 failing templates. Actions: Pause, Resume, Drain DLQ, Replay row, Force-expire stale.

---

## Migration plan (strangler fig, zero downtime)

| Phase | Outcome | Risk |
|---|---|---|
| **0. Freeze** | Lock the 6 cron jobs at current behavior; tag the current state as `pre-refactor-2026-06-09` in `refactor_kpi_daily`. | None |
| **1. Domain + ports** | Pure TS in `supabase/functions/_shared/email/domain/**` + `ports/**` with 60+ contract tests. No runtime touch. | None |
| **2. Infrastructure** | `email_outbox` table + RPCs (`claim_due_emails`, `record_attempt_result`, `policy_get/set`). Backfill from `email_send_log`+`pgmq` in a single transaction; pgmq queues drained then dropped after Phase 4. | Low — additive |
| **3. Application + new dispatcher** | New edge fn `email-dispatcher` runs the Scheduler. `auth-email-hook` + `send-transactional-email` + `send-announcement-email` switch to `EnqueueEmail` use-case (thin shim — same external contract). | Medium — feature-flag `email_pipeline_v2_enabled` defaults OFF; flip per-lane (auth → tx → bulk) over 3 days. |
| **4. Decommission** | Delete `process-email-queue`, `reconcile-stuck-emails`, `replay-dlq-emails`, `replay-email-dlq`, `email-pipeline-health` (folded into v2 console). Drop pgmq queues + 4 throttle/state columns. Convert `email_send_log` to view. | Low — gated by Phase 3 stability for 72 h |
| **5. Console v2** | New `EmailControlCenter` page replaces 6 scattered cards. Old cards stay during transition, then removed. | None |
| **6. Hard-cap regressions** | ESLint rule `no-legacy-email-send` bans `supabase.functions.invoke("send-transactional-email"|"send-announcement-email"|"send-project-blast")` — must go through `EnqueueEmail`. CI guard `check-email-architecture.mjs` walks `supabase/functions/_shared/email/**` and fails on direct provider/DB calls outside the infra layer. | None |

Each phase is independently shippable and behind feature flag `email_pipeline_v2_enabled` (per-lane bitmask). Rollback = flip flag; no data loss because v1 and v2 read/write the same `email_outbox` table after Phase 2.

---

## Security posture (no regressions; tightens several)

- All new RPCs `SECURITY DEFINER`, `SET search_path = public`, `REVOKE ALL FROM public/anon/authenticated`, explicit `GRANT EXECUTE TO service_role` (admin-callable ones get `has_role(auth.uid(),'admin')` gate).
- `email_outbox` RLS: deny everything except `service_role`; admin reads via `get_email_outbox(...)` RPC that strips PII payload by default.
- `payload` column encrypted-at-rest via `pgcrypto` symmetric with key in vault (rotation-safe — matches existing PII pattern).
- All edge fns continue to use `_shared/service-role-auth.ts` (JWT **or** `sb_secret_*` token) per the cron-key memory.
- No new public endpoints. No widening of CORS. Idempotency required on every Enqueue call.

---

## Cost posture (target ≥ 30 % drop)

| Lever | Before | After |
|---|---|---|
| Cron invocations | 6 jobs × 12/min = 72/min | 1 dispatcher × 12/min + 2 reconcilers × 1/min = 14/min (−80 %) |
| Per-claim DB round-trips | 4 (pgmq pop + state read + log upsert + audit) | 1 (`claim_due_emails` returns batch w/ side-effects) |
| Edge fn cold-starts | ~2 K/day across 6 fns | ~400/day on dispatcher (pooled isolate) |
| Provider 429 retry waste | Re-sends on every cooldown expiry | CircuitBreaker prevents probe storms (−95 % wasted sends) |
| `email_send_log` storage | ~1 row per attempt × 5 retries | 1 row per email; attempt history compacted into `attempts` jsonb |

---

## What stays

- Provider (Lovable Emails) — unchanged. ProviderPort wraps it.
- React Email templates under `_shared/email-templates/**` and `_shared/transactional-email-templates/**` — unchanged, the rendering helper just moves behind `TemplateRenderer` port.
- `suppressed_emails`, `email_unsubscribe_tokens`, `email_workspace_throttle` (becomes the persistence row for `CircuitBreaker` + `TokenBucket` policies — renamed columns, data preserved).
- All BDD `EMAIL-RL-001..017`, `ANN-CAP-001..005`, `EMAIL-HYG-*` — re-asserted against v2 contracts; none deleted, ~20 new added.

## What ships in this PR series (each its own approved migration/diff)

1. `supabase/functions/_shared/email/domain/**` + 60 contract tests.
2. `supabase/functions/_shared/email/application/**` + use-case tests.
3. `supabase/functions/_shared/email/infrastructure/**` (Pg repos, LovableEmailsProvider).
4. Migration: `email_outbox` table + RPCs + backfill + view-shim for `email_send_log`.
5. New edge fn `email-dispatcher` (pinned in `config.toml`, `verify_jwt=false`, service-role-auth).
6. Shims: `auth-email-hook`, `send-transactional-email`, `send-announcement-email`, `send-project-blast`, `send-application-confirmation`, `send-community-agreement-trigger`, `send-magic-link` → call `EnqueueEmail`.
7. Feature flag `email_pipeline_v2_enabled` in `app_settings`; per-lane bitmask.
8. New `src/pages/admin/SystemHealth/EmailControlCenter.tsx` + lane cards, replacing `EmailBulkThrottleCard` + scattered tiles.
9. Decommission migration: drops `pgmq.q_auth_emails`, `q_transactional_emails`, `q_bulk_emails`, `bulk_paused`, `*_consecutive_rate_limits`, `*_retry_after_until`, `bulk_retry_after_until`, the standalone `clear_email_lane_cooldown` RPC (replaced by `pause_lane`/`resume_lane`).
10. ESLint rule `no-legacy-email-send` + CI guard `scripts/ci/check-email-architecture.mjs`.
11. BDD: `EMAIL-V2-001..030` covering ports, scheduler fairness, CircuitBreaker transitions, idempotency, suppression, frequency cap, expiry, retention, console actions, security RLS.
12. Memory updates: replace `mem://features/email-queue-per-lane-cooldown`, `mem://features/email-lane-isolation`, `mem://features/email-workspace-token-bucket`, `mem://features/email-frequency-cap` with one canonical `mem://features/email-subsystem-v2` plus a deprecation note pointing to it.
13. Runbook `docs/runbooks/email-subsystem-v2.md` — operator guide, SLOs, rollback, on-call playbook.

## What I will NOT do in this refactor

- Switch email provider — out of scope; the port is the seam.
- Change React Email templates — they render identically.
- Touch auth flows themselves — `auth-email-hook` keeps its public contract.
- Re-architect notifications (push, in-app, Discord) — separate subsystem; only the email path moves.

## Verification gates per phase

- Phase 1–3: 100 % unit on domain + use-cases; integration on infrastructure; staging soak 24 h before flag flip.
- Phase 3 flag flip: per-lane canary 1 % → 10 % → 100 % over 24 h, gated on `ops_metrics`: zero rise in `dlq_count`, p95 send latency ≤ baseline, zero `severity:error` rows tagged `lane:<x>`.
- Phase 4 decommission: blocked until 72 h post-100 % with all gates green.
- Phase 6: CI red unless `check-email-architecture` and `no-legacy-email-send` pass.

## Estimated size

~3,500 lines added (mostly tests), ~2,200 deleted, net **−1,200**, plus 6 deleted edge fns, plus 12 deprecated migrations folded into 1 backfill. One review-able PR per phase.
