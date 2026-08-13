# ADR-0002: External SPF ingestion / sync subsystem

- **Status:** Accepted (2026-08-10)
- **Related:** [ADR-0001](0001-spf-single-source-of-truth.md),
  [ADR-0003](0003-framework-graph-rebuild-facade.md)

## Context

We must pull ~29 SPF datasets from the public GitHub Pages `v1` API into the app as a durable,
versioned snapshot ([ADR-0001](0001-spf-single-source-of-truth.md)). The source is untrusted
external JSON fetched over the network with no auth; it grounds an LLM (Fleety) and the
hand-off generator, so **data poisoning and partial/stale ingestion are security and
correctness risks**, not just reliability ones. The repo already has an ingestion seam
(`reference_data_sources` + a `framework-csv-fetch`-style function) to model on.

## Decision

Build a background **`spf-sync`** subsystem (a scheduled Deno edge function / job — **not** on
any user request path) that, per dataset:

1. Fetches the pinned `v1` URL under an **SSRF guard** (host allow-list, https-only, resolve +
   re-check IP against private/metadata ranges, no auto-redirect, cert validation on).
2. **Validates the payload against a pinned `v1` JSON-schema contract** (allow-list of
   expected fields/types); records `checksum` + `fetched_at` + `version`; ignores unknown new
   fields (schema-evolution tolerance) but **fails closed** on a shape violation.
3. Writes the raw payload to `spf_datasets_raw` (provenance + rollback source), then normalizes
   into the `spf_*` snapshot tables.
4. Performs an **atomic swap** of the active snapshot pointer — Fleety/consumers never read a
   half-written set. Idempotent (re-ingesting an identical version is a no-op), checkpointed
   and resumable, and throttled to protect the DB.

Timeouts on every fetch; retry with exponential backoff + jitter (capped); circuit breaker on
the upstream. Emits golden-signal metrics + a freshness SLI. The sync DB role is
least-privilege (no `DROP`/`ALTER`).

## Alternatives considered

1. **Fetch inline when a consumer needs data.** Couples every read to GitHub Pages latency/
   uptime and repeats validation cost; no reproducibility. Rejected.
2. **Client-side fetch in the SPA.** Ships the (public) data fine but gives no server-side
   validation, no snapshot, no grounding integrity for edge-side LLM calls. Rejected.
3. **Trust the feed (no schema validation / checksum).** Cheapest, but the feed is untrusted
   external input that grounds an LLM — a poisoned or malformed dataset would flow straight to
   users. Rejected; validation + provenance is mandatory (`ai-llm-agent-security.md`).

## Consequences

- **Easier:** last-good snapshot enables graceful degradation during upstream outages; version
  pinning enables reproducible generation and clean rollback; validation blocks poisoned/broken
  data at ingest.
- **Harder / accepted:** we own a sync cadence, a freshness SLO, and a runbook for sync
  failure / GitHub Pages outage; the pinned `v1` contract must be updated deliberately when SPF
  ships `v2` (a controlled change, surfaced by a failing contract test rather than a silent
  break).
