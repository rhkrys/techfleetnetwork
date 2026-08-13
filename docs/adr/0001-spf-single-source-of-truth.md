# ADR-0001: SPF becomes the single source of truth for the framework data layer

- **Status:** Accepted (2026-08-10)
- **Deciders:** Tech Fleet owner + engineering
- **Related:** [ADR-0002](0002-spf-ingestion-sync-subsystem.md),
  [ADR-0003](0003-framework-graph-rebuild-facade.md); `docs/framework/open-data-strategy.md`

## Context

The Skills & Practices Framework (SPF) launched publicly on 2026-08-10 as a versioned
open-data product — static JSON on GitHub Pages
(`https://techfleetworks.github.io/skills-and-practices-framework`, `v1`, ~29 datasets,
generated from Baserow, CC BY 4.0). Per `open-data-strategy.md`, **the public Git repo is now
the canonical source of truth** for the framework; everything else is a derived read model.

Today the app carries its own copy of the framework in `reference_*` tables + the
`framework_entity_v` view + the `framework_edges` graph, populated from an earlier CSV
ingestion path. These power Fleety (the AI coach's RAG + graph injection), the Journeys
section, and search. This local copy predates the public SPF and does **not** contain the
`handoff-deliverables-map` or the career-transitioning datasets, and it can silently drift
from the now-canonical public data.

The owner's directive: SPF is to become the **one authoritative source** that Fleety, the
Journeys section, the new Hand-Off Production System, and future features all read from — not
a per-feature dependency.

## Decision

Adopt the public SPF `v1` API as the **single upstream source of truth** for framework data,
consumed into the app as a **documented, versioned, derived snapshot** (`spf_*` schema, see
[ADR-0002](0002-spf-ingestion-sync-subsystem.md)) that is synced from the public API and
**version-pinned per consumer read** where reproducibility matters (e.g. each hand-off
production run pins the `spf_version` it used).

The existing `reference_*` tables + `framework_edges` graph are **replaced** by graph
structures rebuilt from the SPF snapshot, exposed through a source facade
([ADR-0003](0003-framework-graph-rebuild-facade.md)) so the migration is a strangler-fig
cutover, not a big-bang. The local snapshot is a **derived index of an external authoritative
source**, not a competing source of truth — its existence and sync mechanism are documented,
per `database-architecture.md`.

## Alternatives considered

1. **New standalone snapshot alongside `reference_*` (no replacement).** Safest for Fleety,
   but leaves two framework homes that drift — explicitly rejected by the owner, who wants one
   source of truth for the platform.
2. **Runtime fetch + short cache only (no snapshot tables).** Simplest, but couples production
   Fleety/Journeys/hand-off generation to GitHub Pages uptime, gives no reproducibility
   (version pinning), and is not a durable layer future features can build on. Rejected.
3. **Keep `reference_*` as the source; sync SPF into it in place.** Would mutate the live graph
   Fleety depends on with no clean rollback boundary; the schema shapes differ (SPF has a
   dedicated handoff map, career-transitioning, slug-based links). Rejected in favor of a
   parallel snapshot + facade that keeps rollback a flag flip.

## Consequences

- **Easier:** one authoritative, versioned framework layer; new features (hand-off,
  career coaching, Journeys) read one contract; framework data can no longer silently drift
  from the public standard; reproducible hand-off generation via `spf_version` pinning.
- **Harder / accepted risk:** the cutover touches Fleety and Journeys, which are live for ~767
  users — this is the highest-risk item in the programme. It is mitigated by expand/contract +
  a source facade + canary + a verified restorable backup, and the destructive drop of
  `reference_*` is a separate, owner-confirmed release ([ADR-0003](0003-framework-graph-rebuild-facade.md)).
- We take on an **external dependency** on GitHub Pages availability and on SPF `v1` schema
  stability; mitigated by the snapshot (serve last-good), a pinned `v1` contract test that
  fails CI on drift, and graceful degradation (see the resilience decisions in the plan).
- The SPF data is **public, non-personal** (CC BY 4.0), so most privacy obligations do not
  attach to the snapshot itself; attribution is tracked. Personal data enters only via the
  hand-off feature's uploads (handled separately).
