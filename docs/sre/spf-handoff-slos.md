# SLIs / SLOs / Error Budgets — SPF Sync + Hand-Off Production

Status: Phase 0 governance artifact. Defines the reliability targets to instrument BEFORE
launch (SRE production-readiness). 100% is explicitly not the target — each SLO carries an
error budget and a policy for when it's spent.

## SPF sync (data-pipeline SLIs — [ADR-0002](../adr/0002-spf-ingestion-sync-subsystem.md))

| SLI             | Definition                                                  | SLO (rolling 28 days)                                      |
| --------------- | ----------------------------------------------------------- | ---------------------------------------------------------- |
| **Freshness**   | fraction of time the active snapshot's age ≤ 24h            | ≥ 99%                                                      |
| **Success**     | successful sync runs / attempted runs                       | ≥ 99%                                                      |
| **Correctness** | syncs passing schema-contract + row/checksum sanity / total | 100% target (fail-closed: a failing sync must NOT swap in) |

**Error-budget policy:** budget burn → freeze SPF-data feature work, fix sync reliability
first. Freshness breaches during a confirmed GitHub Pages outage are excused (last-good
snapshot is served — graceful degradation, not an outage for our users).

## Hand-off production (request-oriented SLIs — [ADR-0004](../adr/0004-handoff-pipeline-async.md))

| SLI              | Definition                                                                         | SLO                |
| ---------------- | ---------------------------------------------------------------------------------- | ------------------ |
| **Availability** | successful produce runs / **valid** produce requests (exclude 4xx invalid-input)   | ≥ 99%              |
| **Latency**      | fraction of runs completing end-to-end under target (upload→parse→LLM→PDF→Storage) | ≥ 95% under target |
| **Correctness**  | runs producing all 4 valid narratives (both formats) / total                       | ≥ 99%              |

Latency target to be set from the Phase B2 load-test baseline (p95), not guessed. SLA (if any
is ever offered) stays looser than the SLO.

## Golden signals to instrument (both sync + pipeline)

- **Latency** — split success vs failure; p50/p95/p99 (never averages).
- **Traffic** — produce/upload/sync rates; concurrent pipeline jobs; queue depth.
- **Errors** — by stage/type dimension: `upload_reject | parser_fail | figma_fail | groq_fail
| pdf_fail | sync_fetch_fail | schema_fail` (+ service version).
- **Saturation** — worker queue depth, Groq rate-limit headroom, Storage usage, DB pool.

Plus: a **correlation id** generated at entry and propagated through every stage → each LLM
call → Storage → every log line; a service-overview dashboard (signals + SLO attainment +
budget burn + deploy annotations); liveness + **dependency-aware readiness** (reports degraded
when the SPF snapshot is stale beyond threshold or Groq is unreachable).

## Alerting

Symptom-based only, each linked to a runbook, multi-window burn-rate:

- Fast burn (page): produce success rate < SLO over a short window; SPF freshness stale beyond
  threshold; produce p99 > target sustained.
- Slow burn (ticket): gradual budget erosion.
  Never page on cause metrics (CPU) alone.

## Incident severities

- **SEV1** — SPF grounding poisoned/corrupted and served to Fleety, OR a cross-project hand-off
  leak (security/data). All-hands; status comms.
- **SEV2** — pipeline down or Groq/Figma outage blocking produce for many teammates; SPF sync
  failing past freshness SLO.
- **SEV3** — a single parser type failing; one stuck run; cosmetic narrative issue.

Mitigate first (roll SPF to last-good; flip the pipeline kill switch) before diagnosing.
Blameless postmortem for every SEV1/2, action items → regression tests.
