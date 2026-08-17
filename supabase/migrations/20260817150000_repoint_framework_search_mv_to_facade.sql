-- Fix: framework_search_mv (the anchor index search_framework reads) was built over the legacy
-- reference_* tables and was NEVER populated on the new project — so search_framework THROWS
-- (55000 "materialized view has not been populated") and the entire framework-graph injection in
-- techfleet-chat silently fails its try/catch on every turn. Meanwhile the neighbor graph
-- (framework_node_neighbors_mv / framework_edges) now reads SPF ids. The search index and the graph
-- were on different sources, so even a populated reference index would have returned anchor ids that
-- never match an SPF neighbor node.
--
-- Repoint the search MV at framework_entity_v (the source-switchable facade), so search follows
-- framework_active_source() exactly like fw_resolve_entity + the neighbors MV already do. Anchors now
-- come back as SPF (entity_type,id) that match the neighbor graph, and all 20 SPF types (incl.
-- career_transition/methodology/specialization/etc.) become searchable. CREATE ... AS SELECT
-- populates immediately (WITH DATA), so no separate REFRESH is needed here.
--
-- search_framework itself is unchanged (it reads this MV by name; SQL functions are late-bound, so
-- DROP ... CASCADE only removes the MV's own indexes). Refresh helper fw_refresh_search_mv() already
-- exists and REFRESHes this same MV, so the search index now rebuilds from SPF at cutover/backfill.

DROP MATERIALIZED VIEW IF EXISTS public.framework_search_mv CASCADE;

CREATE MATERIALIZED VIEW public.framework_search_mv AS
SELECT
  v.entity_type,
  v.id,
  v.slug,
  v.name,
  v.description,
  lower(v.name) AS name_lc,
  to_tsvector('english', coalesce(v.name, '') || ' ' || coalesce(v.description, '')) AS doc_tsv
FROM public.framework_entity_v v
WHERE v.is_active;

CREATE UNIQUE INDEX framework_search_mv_pk       ON public.framework_search_mv (entity_type, id);
CREATE INDEX        framework_search_mv_name_trgm ON public.framework_search_mv USING GIN (name gin_trgm_ops);
CREATE INDEX        framework_search_mv_name_lc   ON public.framework_search_mv (name_lc text_pattern_ops);
CREATE INDEX        framework_search_mv_doc_tsv   ON public.framework_search_mv USING GIN (doc_tsv);

ANALYZE public.framework_search_mv;
