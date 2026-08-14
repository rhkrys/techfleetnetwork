# ADR-0007: Load-on-demand extraction to bound hand-off worker memory

- **Status:** Accepted (2026-08-14)
- **Related:** [ADR-0006](0006-handoff-material-ingest.md) (material ingest), [ADR-0004](0004-handoff-pipeline-async.md) (async pipeline)

## Context

After the checkpointed Figma ingest (ADR-0006) fixed the pre-checkpoint load crash, a real run
surfaced the **next** ceiling: the worker was killed with **`Memory limit exceeded`** (Supabase edge
functions cap at ~256 MB) during the **extract** stage. Evidence: the failed run's own state
(`cursor: extract i=3`, `facts: 3`, `attempts: 6`) plus the edge log line `Memory limit exceeded` —
an OOM, not a thrown error and not a wall-clock timeout.

Root cause: `loadRunContext` built a `byComponent` map holding **every** source's material text (all
components) in RAM for the whole run, and `extractFacts` read from it. Once boards were actually
ingested, a material-heavy component (one aggregating ~10 Figma boards) pushed the resident set past
256 MB. An OOM cannot be caught — the runtime kills the process — so the run died at the same unit
every tick until the recovery cap.

The owner's directive: **no quick fix, no truncation of real content** — bound memory the right way.

## Decision

**Load each component's material on demand; never hold all of it at once.**

- `loadRunContext` no longer materializes source text. It does only **lightweight** reads: the output
  **link map** (`component_slug`, `external_url`) and the **Figma ingest plan** (ids/urls of sources
  whose `extracted_text` is still null). No `byComponent`; no source content in RAM.
- `extractFacts(component)` reads **only that component's** submissions (`text_content` +
  `extracted_text`) at extract time, processes them (chunk → DeepSeek → merge/dedupe), and returns —
  so exactly **one component's material is resident at a time**, released before the next. Ingest
  units run + commit before extract in cursor order, so `extractFacts` reads each source's
  `extracted_text` fresh from the DB (no in-memory hand-off from the ingest stage).
- This composes with ADR-0006's checkpointed, one-source-per-unit **ingest** (already one board in
  RAM at a time). Both stages are now bounded to a single unit's working set.

Supporting controls (belt-and-suspenders, not the mechanism):

- A per-source **pathological guard** (`MAX_EXTRACTED_CHARS`) set FAR above any real board's text, so
  it never truncates genuine content — it only stops a runaway source from being unbounded.
- Per-chunk **try/catch** in `extractFacts` (mirrors `writeArc`): a chunk that fails extraction
  (terminal LLM error, refusal) degrades to no-facts for that chunk instead of failing the run —
  a robustness gap that previously let one component kill the whole run.

## Alternatives considered

1. **Per-component / per-source truncation caps** (the quick fix). Bounds memory but **drops real
   content** from material-heavy components. Rejected by the owner — content fidelity is the point.
2. **Parallel/async fetch of many sources at once.** Would make memory _worse_ (N blobs resident
   simultaneously), not better. Rejected — sequential, one-unit-at-a-time is the memory-safe shape.
3. **A separate always-on / larger worker (persistent compute).** Removes the 256 MB limit but adds
   infra + ops for a low-volume feature. Deferred per ADR-0004's "don't over-engineer" — revisit only
   if a _single_ unit (e.g. one Opus writer arc) still bumps a ceiling after this.

## Consequences

- **Easier:** the worker's resident set is bounded to one component's material regardless of how many
  boards/files/links a run has; no content is truncated; re-produce still reuses durable
  `extracted_text` (no re-fetch).
- **Cost/accepted:** one extra small DB read per component at extract time (26 tiny queries), in
  exchange for a hard memory bound. Negligible at this volume.
- **Not yet addressed (tracked):** source-type-aware extraction; file parsers (PDF/DOCX/XLSX/CSV/
  TXT/MD); public-link fetch; **vision for Figma _design_ files** (design frames carry no text, so a
  text extractor gets nothing — needs render-to-image + Gemini vision); the deploy-workflow
  cross-function-import gap (a `pipeline.ts` change must redeploy `handoff-worker` by hand).
