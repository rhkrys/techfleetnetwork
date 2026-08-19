# ADR 0013 — Fleety retrieval lexical fallback (remove the query-embedding single point of failure)

- Status: Accepted
- Date: 2026-08-19
- Deciders: TechFleet (owner)
- Related: `techfleet-chat` retrieval path; `fleety_kb_semantic_search` (0028/0029 lockdown); the "Fleety saw no SPF at all" incident

## Context

Fleety's KB retrieval ran **only** when a per-query embedding succeeded (`embedQuery` → `fleety_kb_semantic_search`). Two facts made this a single point of failure:

1. **Every question needs a fresh embedding.** Document embeddings are stored once, but to search them you must vectorize the _user's question_ on every turn — a live call to Gemini.
2. **One shared free-tier key.** When its daily quota trips (HTTP 429), `embedQuery` returns null, semantic search is skipped, and there was **no fallback** (the trigram fallback was a never-built TODO — "UC-22"). So Fleety went blind to the **entire** corpus at once — skills, practices, careers — then recovered when quota reset. This produced the "Fleety can't see any SPF data" reports even though 2171 KB rows are embedded and healthy.

## Decision

Add a **lexical fallback** that needs no embedding:

- **`fleety_kb_lexical_search(p_query text, p_limit int)`** (migration `20260818140000`): OR-combines the query's terms into a Postgres full-text query over `to_tsvector(title || content)`, ranked by `ts_rank`, GIN-indexed. Input is sanitized to `[a-z0-9 ]` before `to_tsquery` (no tsquery-syntax injection). `SECURITY DEFINER` + fixed `search_path`; EXECUTE revoked from anon/authenticated/PUBLIC, granted only to `service_role` — identical posture to `fleety_kb_semantic_search`.
- **`techfleet-chat`**: when the query embedding is unavailable **or** semantic search returns zero hits, call the lexical RPC. A `kbRetrievalMode` (`semantic`|`lexical`|`none`) + `embeddingDegraded` flag are logged (WARN on degrade) and exposed as `X-Fleety-Retrieval`, so an outage is loud, never silent.

## Consequences

- The documents (already embedded, and independently searchable by text) are never unreachable because of one live API call. Quota outage → Fleety still answers from KB via lexical search.
- OR-combined terms also fix the AND-of-terms brittleness that made conversational queries miss.
- Observability: retrieval mode is visible per turn (header + logs) — a degrade is detectable/alertable.
- Migration is applied manually to prod (`_apply_lexical_fallback.mjs`, idempotent). Rollback = drop the function; the caller degrades to the prior no-fallback behavior.
- **Follow-ons (separate):** (1) `spf-sync` self-heal (rebuild edges + refresh MVs after a sync — the graph channel's own staleness), (2) embed the remaining SPF types (`tool`, `job_industry`, `project_type`, …) + paginate the embed backfill. Tracked; not in this ADR.
