# ADR-0004: Hand-off generation as an async pipes-and-filters pipeline

- **Status:** Accepted (2026-08-10)
- **Related:** [ADR-0005](0005-llm-model-capability-port.md)

## Context

"Produce Hand-Offs" runs a multi-stage job over a project's uploaded deliverables: parse →
normalize → map to story-arc components → extract a fact base → write four audience versions
via an LLM → assemble → render Markdown + PDF. This is slow and bursty (multiple LLM calls +
parsing + PDF render per run). Deno edge functions are a weak fit for long-running work, and a
synchronous request would time out and couple the user's browser to a multi-minute job. The
pipeline also calls unreliable externals (Groq, Figma, parsers, Storage) and must not, when it
runs, starve Fleety's graph-RPC serving path.

## Decision

Implement production as an **asynchronous, queued pipes-and-filters pipeline**, triggered by a
"Produce Hand-Offs" request that enqueues a run and returns immediately; the SPA polls run
status/progress. Each stage is an independent filter with an explicit contract; a run is a row
in `handoff_productions` moving through a state machine (queued → parsing → … → complete/failed).

Controls (from the security/resilience/SRE vetting):

- **Idempotency key** per run; **one-run-per-project** concurrency invariant (no double-run).
- **Timeouts** on every external call; retry w/ backoff+jitter (capped); **circuit breaker** on
  Groq/Figma; **bulkhead** isolating the pipeline's resource pool from Fleety's serving pool.
- **Spend + iteration caps** per run and per user; per-user rate limit on triggering.
- **Resumable/atomic writes** — a Storage-write failure mid-run leaves no partial run marked
  complete; the run is safely re-runnable.
- **Correlation ID** propagated entry → each stage → each LLM call → Storage → logs.
- Queue **depth / consumer lag** monitored as first-class metrics.

## Alternatives considered

1. **Synchronous edge function.** Times out on real inputs, couples the browser to a
   multi-minute job, no retry/resume. Rejected.
2. **A dedicated worker service / external queue (Kafka, SQS).** Over-engineered at 767 users
   and this volume; a Postgres-backed job/queue table with a scheduled worker (the repo's
   existing outbox/fanout idiom) is right-sized. Rejected per the "don't over-engineer" rule.

## Consequences

- **Easier:** long runs don't block users; failures retry/resume; the expensive pipeline can't
  starve the coach; cost and abuse are capped.
- **Harder / accepted:** we own a job/queue table, a worker, a status/progress UI, and a
  "pipeline stuck/failed" runbook; exactly-once semantics require care (idempotency keys +
  the one-run invariant).

## Implementation (2026-08-11)

The queue is `handoff_productions` itself (no separate broker — right-sized at this volume),
extended with a lease: `worker_id`, `lease_expires_at`, `heartbeat_at`, `attempts`
(crash-recovery count), and `pipeline_state` (resumable cursor + accumulated fact base + written
prose). Migration `20260811130000_handoff_worker_queue.sql`.

- **Enqueue-only front door** (`handoff-produce/index.ts`): auth + produce-gate + 26-gate +
  one-run invariant, then inserts a `queued` row and returns `202`. No inline work — the old
  `EdgeRuntime.waitUntil` path was deleted, since a recycled invocation could strand a run.
- **Durable worker** (`handoff-worker/index.ts`, `pg_cron` every minute, service-role only):
  claims the oldest due run with a lease (`handoff_claim_run`, `FOR UPDATE SKIP LOCKED`), drives
  it under a soft time budget, and **checkpoints after every unit** (`handoff_checkpoint_run`,
  which also returns whether the lease is still held → stop on takeover). Out of budget → clean
  `handoff_release_run` (resumes next tick, no penalty); done → `handoff_complete_run` (flips
  `is_latest`, clears `pipeline_state`); infra error → left leased to lapse and be retried.
- **Resumable step machine** (`pipeline-steps.ts`, pure + unit-tested): a run is an ordered list
  of units (extract-per-component, write-per-arc, finalize-per-audience) with a persisted cursor;
  completed units are behind the cursor and never re-run. Per-arc writing keeps each LLM response
  small (see ADR-0005 — avoids reasoning-model truncation and provider structured-output limits).
- **Crash recovery, not tick counting:** `attempts` increments only when a still-owned run is
  reclaimed after its lease lapsed (a worker death); normal multi-tick progress via clean release
  does not count. After the recovery cap the claim marks the run `failed`. Recovery of a stuck run
  is documented in `docs/runbooks/handoff-pipeline-stuck.md`.
