# ADR-0003: Framework-graph rebuild behind a source facade

- **Status:** Accepted (2026-08-10)
- **Related:** [ADR-0001](0001-spf-single-source-of-truth.md),
  [ADR-0002](0002-spf-ingestion-sync-subsystem.md)

## Context

Fleety reads the framework as a graph via RPCs (`search_framework`,
`get_nodes_neighbors_batch`, `fw_lookup_relationships`, `get_node_neighbors`) over
`framework_edges` + the `framework_node_neighbors_mv` / `framework_search_mv` materialized
views + `reference_relationships`, all downstream of `reference_*` via
`fw_emit_edges_for_entity` + `fw_refresh_*`. `framework_entity_v` (a 9-column UNION over the
18 `reference_*` tables, granted to `anon`) backs `src/services/reference.service.ts` public
reads. Replacing the source ([ADR-0001](0001-spf-single-source-of-truth.md)) must not break
these live consumers of a 767-user production app. A big-bang table swap has no safe rollback.

**Verified blast radius (grounding, 2026-08-10):** the **Journeys section is decoupled** — it
reads `journey_progress` + static `src/data/*-course.ts`, not the framework tables — so the
cutover does **not** affect Journeys today (future Journeys work can read the new layer). The
real live consumers to protect are **Fleety** (graph + search) and the **anon/authenticated
`framework_entity_v` read path**.

**Preservation constraints (must not be clobbered by the cutover):**

- `reference_*` has **writers beyond the CSV loader** — `scrape-figma-workshops` (UPDATEs
  `reference_workshops`) and `fill-content-gaps` (UPDATEs all `reference_*`,
  `description_source='ai_generated'`). The loader's **`description_source` precedence**
  (`admin` > `ai_generated` > `csv`) protects human + AI descriptions; SPF ingest MUST preserve
  it or silently overwrite curated content.
- `reference_relationships` (feeds `fw_lookup_relationships`) is **migration-seeded, not in the
  SPF feed** → it is **kept as-is**, not replaced.
- The `framework_entity_v` **9-column contract** (`entity_type,id,slug,name,description,
category,data,is_active,updated_at`) and its **`anon` SELECT grant** are load-bearing.
- The edge-emission + MV-refresh chain (`fw_emit_edges_for_entity` → `fw_replay_staging` →
  `fw_refresh_neighbors_mv`/`fw_refresh_search_mv`) must run over the new source too, or the
  neighbor/search RPCs go stale.

## Decision

Rebuild `framework_entity_v` + `framework_edges` **from the SPF snapshot** into new-source
structures, and route the graph reads through a **source facade** switched by an
`active_source` value on a **singleton config table** (`framework_source_config`, `id=1
CHECK(id=1)`, admin-read / service-write RLS — mirroring the repo's `email_policy_config` +
`pipeline_v2` strangler-fig precedent; default = OLD `reference_*`). No new feature-flag
framework is introduced. The rebuild **reuses the existing machinery**
(`fw_emit_edges_for_entity` → `fw_replay_staging` → `fw_refresh_*` MVs) fed from the new
source, and **preserves `description_source` precedence** so curated/AI descriptions survive.
This is a **strangler-fig** cutover:

1. **Expand:** stand up SPF-backed graph structures alongside the existing ones; nothing reads
   them yet.
2. **Verify parity:** automated checks assert node/edge counts and RPC-output parity
   (shadow-compare old vs new) + an empty-graph guard.
3. **Canary:** flip `framework.spf-source` progressively; watch graph-RPC error rate + result
   counts + Fleety answer validity; auto-abort/flip-back on regression or empty results.
4. **Bake**, then **contract** (drop `reference_*`) only in a separate, owner-confirmed release
   after a verified restorable backup + the lockout/accidental-deletion check.

The rebuild uses batched reads (`WHERE id IN (...)`, no N+1) and lookup maps (no O(n²)), under
Read Committed with an atomic swap. Entity-type plural/singular mismatch between the view
(`skills`) and the enum (`skill`) is normalized in the rebuild mapping. RAG vectors in
`knowledge_base` derived from framework data are re-embedded via a batched/resumable backfill
using the existing `_shared/gemini-embed.ts` contract.

## Alternatives considered

1. **Big-bang: repoint RPCs and drop `reference_*` in one migration.** No mixed-version
   safety, no fast rollback; violates expand/contract. Rejected.
2. **Dual-write both graphs indefinitely.** Avoids a cutover but permanently doubles write cost
   and keeps two sources of truth — the opposite of [ADR-0001](0001-spf-single-source-of-truth.md).
   Rejected; dual-read via the facade during cutover only.
3. **A full feature-flag platform.** Over-engineered at 767 users; a single server-side toggle
   read by the facade is right-sized. Rejected.

## Consequences

- **Easier:** rollback is a toggle flip (< 5 min) as long as `reference_*` still exists; the
  risky consumer (Fleety) is cut over gradually with guardrails; parity is proven before users
  are exposed.
- **Harder / accepted:** during cutover two graph builds coexist (extra storage + a rebuild
  job); the toggle is a cleanup obligation (removed in the contract release). The destructive
  drop is irreversible and gated behind explicit owner confirmation + a restore-tested backup.
