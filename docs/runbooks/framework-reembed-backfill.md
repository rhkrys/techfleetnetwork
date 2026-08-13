# Runbook — Framework re-embed / backfill

Skeleton (finalized in Phase A2). After the SPF-backed graph rebuild, RAG vectors in
`knowledge_base` derived from framework data must be re-embedded so Fleety retrieves against
current content. Uses the shared `_shared/gemini-embed.ts` contract (`gemini-embedding-001`,
768-dim). Also the recovery step after a poisoning cleanup.

**When to run:** after a framework source cutover / rebuild; after a schema change to the
embedded content; after remediating a poisoned/incorrect snapshot.

**Principles (batched/resumable/throttled — release-safety):**

- Batch (e.g. 200–1000 rows/batch) with a sleep between batches to protect the DB.
- **Idempotent + resumable**: track a checkpoint (last-processed id / `embedding_model` tag) so
  a failure restarts without redoing or skipping — re-embed only rows not on the current
  `GEMINI_EMBED_MODEL_TAG`.
- **Throttle** on DB load (replication lag / CPU); back off automatically.
- Run as a **background job**, never inside a deploy step.
- Never a one-shot UPDATE over all vectors.

**Verify after:** spot-check Fleety retrieval hit-count > 0 on known queries; confirm no rows
left on a stale embedding tag; freshness SLI green.

**Rollback:** re-embedding is additive (writes vectors); if a batch produced bad vectors, its
rows are re-runnable. The framework-source flip itself rolls back via `framework_source_config`
([ADR-0003](../adr/0003-framework-graph-rebuild-facade.md)).

_TODO (Phase A2): backfill function name, checkpoint column, batch size, invoke command._
