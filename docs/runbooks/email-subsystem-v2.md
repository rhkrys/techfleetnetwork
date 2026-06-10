# Email Subsystem v2 — Operator Runbook

> Companion to `mem://features/email-subsystem-v2`. Use this when paging in
> on email-pipeline alerts or during the strangler-fig rollout.

## Architecture at a glance

```
Interface  →  Application       →  Domain (pure)        →  Infrastructure
(edge fns,    EnqueueEmail          LaneRouter              PgOutboxRepo
 cron,        DispatchDue           BackoffStrategy         PgPolicyRepo
 console)     HandleResult          CircuitBreaker          PgSuppressionRepo
              PauseLane             FrequencyCap            LovableEmailsProvider
              ResumeLane            SuppressionGate         OpsEventSink
```

Single canonical store: `public.email_outbox` (status: `pending → sending →
sent | dlq | suppressed | expired`). The legacy pgmq queues + `process-email-queue`
stay live until the strangler bitmask reaches 7 and a 72-hour green soak.

## Feature flag (strangler-fig)

```sql
-- bitmask: 1=auth, 2=transactional, 4=bulk
SELECT pipeline_v2_lanes_bitmask FROM email_send_state;

-- Enable auth lane on v2:
UPDATE email_send_state SET pipeline_v2_lanes_bitmask = pipeline_v2_lanes_bitmask | 1;

-- Disable bulk lane on v2 (back to legacy):
UPDATE email_send_state SET pipeline_v2_lanes_bitmask = pipeline_v2_lanes_bitmask & ~4;
```

Rollback = bitwise-AND the lane off. No data loss — both pipelines read/write
the same `email_outbox` from Phase 2 onward.

## Service-Level Objectives

| Lane          | p95 send latency | DLQ rate (24h) | Circuit-open seconds (24h) |
|---------------|------------------|----------------|----------------------------|
| auth          | ≤ 30 s           | ≤ 0.5 %        | ≤ 60 s                     |
| transactional | ≤ 60 s           | ≤ 1.0 %        | ≤ 300 s                    |
| bulk          | ≤ 5 min          | ≤ 2.0 %        | ≤ 1800 s                   |

Breach → page on-call via the Triage Critical Push channel.

## Triage flow (page → fix in ≤ 15 min)

1. Open **System Health → Email v2**.
2. Read the three lane cards:
   - **Closed + flag on + low pending** → not the email pipeline.
   - **Open** → CircuitBreaker tripped on workspace-quota 429s. Check
     `recent_429_count` and `probe_at`. If `probe_at` is in the future, the
     scheduler will half-open on its own; no action required.
   - **Paused** → an admin or auto-pauser set `paused_by_admin=true`. Read
     `paused_reason`. If incident resolved, click **Resume lane**.
3. Scan the Outbox table:
   - Status `dlq` with `dlq_reason='suppressed'` → recipient on the
     suppression list; no action.
   - Status `dlq` with `dlq_reason='max_attempts'` and a transient
     `last_error` → safe to replay (Phase 4 will surface a Replay action;
     today: bump `attempts=0`, `status='pending'`, `next_attempt_at=now()`
     via SQL).
   - Status `expired` → outbox row aged past `expires_at` (auth: 15 min;
     other: 60 min). Confirm with the user; do NOT auto-replay.
4. If queue depth is growing across lanes → check `email-dispatcher` logs
   for an upstream provider outage. Pause the affected lane(s) to stop
    429 storms, leave the others running.

## Manual lane controls (admin SQL)

```sql
-- Pause a lane (also surfaced as a button in the v2 console):
SELECT pause_email_lane('bulk', 'investigating provider 429s');

-- Resume a lane (also clears circuit + 429 counters):
SELECT resume_email_lane('bulk');

-- Force-expire long-stale pending rows:
SELECT gc_expired_email_outbox();
```

## Provider swap (future)

Implement `ProviderPort` in
`supabase/functions/_shared/email/ports.ts` against the new provider
(Resend / SES / Mailgun) under
`supabase/functions/_shared/email/infrastructure/<provider>-provider.ts`,
then swap the binding inside `composition.ts`. Domain + application layers
are untouched. CI guard `scripts/ci/check-email-architecture.mjs` enforces
the layering.

## Decommission gates (Phase 4)

Do NOT drop legacy artifacts until:

1. `pipeline_v2_lanes_bitmask = 7` for ≥ 72 hours.
2. `ops_metrics` shows zero rise in `dlq_count` per lane vs the 7-day
   pre-flip baseline.
3. `audit_log` shows zero `severity:error` rows tagged `lane:*` across the
   72-hour soak.
4. Manual replay button in the v2 console is shipped and exercised at
   least once per lane.

Then delete in this order, one PR per step:

1. `process-email-queue` edge function.
2. `reconcile-stuck-emails`, `replay-dlq-emails`, `replay-email-dlq`,
   `email-pipeline-health` edge fns.
3. pgmq queues: `q_auth_emails`, `q_transactional_emails`, `q_bulk_emails`.
4. Columns: `email_send_state.bulk_paused`, `*_consecutive_rate_limits`,
   `*_retry_after_until`, `bulk_retry_after_until`.
5. RPC `clear_email_lane_cooldown` (replaced by `pause_email_lane` /
   `resume_email_lane`).
6. Convert `email_send_log` to a view over `email_outbox` (kept for
   backward-compat reads from existing dashboards).

## Useful queries

```sql
-- Lane health snapshot (used by the v2 console):
SELECT * FROM email_lane_state ORDER BY lane;

-- Outbox depth per (lane, status):
SELECT lane, status, count(*), min(created_at) AS oldest
  FROM email_outbox
 WHERE status IN ('pending','sending','dlq','expired')
 GROUP BY lane, status
 ORDER BY lane, status;

-- Top failing templates in the last hour:
SELECT template, count(*) AS attempts, max(last_error) AS sample_error
  FROM email_outbox
 WHERE status='dlq' AND dlq_at > now() - interval '1 hour'
 GROUP BY template
 ORDER BY attempts DESC
 LIMIT 5;
```

## ESLint guard

`email-v2/no-legacy-email-send` (warn → error once bitmask=7) bans direct
invokes of legacy email edge fns. New call sites MUST go through
`queueTransactionalEmail` / `queueAnnouncementEmail` so the dispatcher's
CircuitBreaker, FrequencyCap, SuppressionGate, and idempotency apply
uniformly.

## Related memory

- `mem://features/email-subsystem-v2` — canonical architecture entry
- `mem://features/email-queue-per-lane-cooldown` — **deprecated**
- `mem://features/email-lane-isolation` — **deprecated**
- `mem://features/email-workspace-token-bucket` — **deprecated**
- `mem://features/email-frequency-cap` — still active for bulk lane cap
