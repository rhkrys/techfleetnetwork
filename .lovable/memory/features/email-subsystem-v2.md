---
name: Email subsystem v2 (Outbox + adaptive scheduler)
description: Layered Domain/Application/Infrastructure/Interface architecture for all outbound email; single Outbox, port-based provider, CircuitBreaker per lane, idempotent enqueue, strangler-fig flagged rollout.
type: feature
---

## Architecture

```
Interface  → auth-email-hook · send-* edge fns · email-dispatcher (cron) · admin UI
Application → EnqueueEmail · DispatchDue (only depend on ports)
Domain     → Lane · PolicyConfig · CircuitBreaker · BackoffStrategy · LaneRouter (pure TS)
Infra      → PgOutboxRepo · PgSuppressionRepo · PgPolicyRepo · LovableEmailsProvider · OpsEventSink
```

Composition root: `supabase/functions/_shared/email/composition.ts → buildEmailContainer()`.

## Storage

- `email_outbox` — single canonical store (lane, template, recipient, payload, idempotency_key UNIQUE, status pending|sending|sent|dlq|suppressed|expired, attempts, next_attempt_at, expires_at, attempt_history jsonb, trace_id). RLS deny-all except service_role; admin reads via `get_email_outbox(...)` RPC (payload scrubbed).
- `email_lane_state` — 3 rows (auth/transactional/bulk), CircuitBreaker state machine (closed/open/half_open + paused_by_admin).
- `email_policy_config` — single-row tunables (backoff caps, breaker thresholds, batch size, expiry minutes).

## RPCs (all SECURITY DEFINER, SET search_path=public, service_role only unless noted)

- `enqueue_email_v2(lane, template, recipient, subject, payload, idem_key, message_id, trace_id) → uuid` — idempotent.
- `claim_due_emails(p_max) → SETOF claimed rows` — FOR UPDATE SKIP LOCKED, fairness auth→tx→bulk, skips lanes with open breaker or admin pause.
- `record_email_attempt_result(id, outcome, code, error, retry_after_s, workspace_quota)` — encodes BackoffStrategy + breaker transitions.
- `gc_expired_email_outbox() → int`.
- `pause_email_lane(lane, reason)` / `resume_email_lane(lane)` — admin-only (has_role).
- `get_email_outbox(lane,status,limit,offset)` — admin-only.

## Edge fn

- `email-dispatcher` (verify_jwt=false, service-role auth in code) — cron every 15s. GCs expired then calls DispatchDue. Replaces `process-email-queue` once bitmask=7 and 72h soak gate passes.

## Strangler-fig rollout

`email_send_state.pipeline_v2_lanes_bitmask` (1=auth, 2=transactional, 4=bulk; default 0). `_shared/transactional-email.ts:queueTransactionalEmail` checks per-lane and routes via `EnqueueEmail` use-case when enabled, otherwise falls through to legacy pgmq pipeline. Same external contract — zero caller changes required.

## Policies (pure domain, contract-tested)

- `routeLane(template)` — AUTH_TEMPLATES → auth, BULK_TEMPLATES → bulk, else transactional.
- `nextBackoffSeconds({attempt,providerRetryAfter,workspaceQuota,cfg})` — workspace-quota capped at 120s even when provider returns Retry-After 3600s (root cause of 2026-06-09 stuck-blast); non-workspace capped at 900s.
- `permitLane(snapshot,now)` — gates dispatch.
- `applyOutcome(snap,outcome,cfg,now)` — pure state machine. 3 workspace-quota 429s in 600s opens breaker, probe_at = now+30s. half_open + 5 consecutive sent closes breaker.

## CI guards

- `scripts/ci/check-email-architecture.mjs` — domain MUST NOT import npm/Deno/fetch (test files exempt); application MUST NOT import infrastructure.
- `supabase/functions/_shared/email/domain/policies.test.ts` — 14 contract tests (Deno).

## What still runs the legacy way (until decommission, Phase 4)

When bitmask < 7, the matching lane still goes through `process-email-queue` + pgmq + `email_send_log`. Both pipelines write to the same `suppressed_emails` and `email_unsubscribe_tokens` so suppression/unsubscribe behavior is identical.

## What this replaces conceptually (do not re-introduce)

- The bulk_paused boolean + `clear_email_lane_cooldown` RPC + per-queue cooldown columns (`*_consecutive_rate_limits`, `*_retry_after_until`, `bulk_retry_after_until`) → all subsumed by `email_lane_state` + CircuitBreaker.
- Three pgmq queues (`auth_emails`, `transactional_emails`, `bulk_emails`) → one `email_outbox` with `lane` column.
- Ad-hoc backoff math scattered across `process-email-queue` → single pure `nextBackoffSeconds`.
- Frequency-cap, suppression, role-mailbox gates remain semantically — they live in the EnqueueEmail use-case and SuppressionGate port (frequency cap to be ported in Phase 4).

## BDD: EMAIL-V2-001..012 in `bdd_scenarios`. Domain tests pass; e2e tests TODO at flag-flip time.

## Decommission gate (NOT YET)

Only delete `process-email-queue`, `reconcile-stuck-emails`, `replay-email-dlq`, `replay-dlq-emails`, `email-pipeline-health`, the three pgmq queues, and the legacy throttle columns AFTER bitmask=7 has been stable for 72 h with zero rise in `ops_events.severity=error` tagged `lane:*` and p95 send latency ≤ baseline.
