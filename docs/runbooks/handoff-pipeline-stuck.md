# Runbook — Hand-off pipeline run stuck / failed

Skeleton (finalized in Phase B2). A production run is a row in `handoff_productions` moving
through a state machine ([ADR-0004](../adr/0004-handoff-pipeline-async.md)).

**Symptom:** a run stays in a non-terminal state past its latency SLO; queue depth / consumer
lag rising; `parser_fail` / `pdf_fail` / storage-write errors.

**Severity:** SEV3 for a single stuck run; SEV2 if queue depth is growing broadly (worker
wedged).

**Diagnose by correlation id:**

1. Which stage is the run in (parse / normalize / map / fact-extract / write-N / assemble /
   render / store)? Which error type fired?
2. **Parser failure on one input** → the run isolates that input with a clear error; it must NOT
   crash the whole pipeline or mark the run complete. Confirm graceful isolation; ask the
   teammate to re-upload a clean file if the source is malformed.
3. **Storage write failed mid-run** → the run is idempotent/resumable; no partial run is marked
   complete. Safe to retry.
4. **Stuck worker** → check saturation + the bulkhead pool (a hand-off run must never starve
   Fleety's serving pool — if it is, that's a bulkhead misconfig, escalate).

**Recover:**

- Retry the run (idempotency key + one-run-per-project invariant prevent double-run /
  double-output).
- If unrecoverable, cancel the run safely (mark failed) — no partial outputs are published and
  (email being deferred) nothing was distributed.

**Do NOT:** manually re-trigger produce in a loop (rate-limit + concurrency cap will reject it;
you'll just burn budget).

_TODO (Phase B2): state-machine states, queue table name, retry/cancel commands, dashboards._
