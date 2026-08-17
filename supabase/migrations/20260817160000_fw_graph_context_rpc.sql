-- A4 graph-aware retrieval: fw_graph_context(). The names-only, arbitrary-first-12 neighbor block in
-- techfleet-chat robbed Fleety of (a) the neighbors' own teaching metadata and (b) any goal-ranking
-- (a duty has ~540 neighbors — the first 12 are noise). This RPC does the traversal in the DB:
--   * pulls 1-hop neighbors of each anchor, both directions, from framework_edges;
--   * joins through the source-switchable facade (framework_entity_v) so it follows active_source;
--   * RANKS neighbors by textual relevance to the conversation goal (p_query) using the same
--     pg_trgm + FTS primitives as search_framework — deterministic, no model call;
--   * caps to p_per_dir per direction (the "mentor, not firehose" cap);
--   * returns each neighbor's NARRATIVE data (scalar/non-array fields) — the teaching content —
--     while the {slug,label} relationship arrays stay expressed as edges/hops (no duplication).
-- 2-hop is done by the caller re-invoking this with the top-ranked neighbors as anchors (same code
-- path, a few anchors, small p_per_dir) rather than a monster recursive CTE.
-- SECURITY DEFINER + service_role only (matches the Fleety RPC lockdown, #221/#222).

CREATE OR REPLACE FUNCTION public.fw_graph_context(
  p_query   text,
  p_anchors jsonb,               -- [{"type":"duty","id":"<uuid>"}, ...]
  p_per_dir integer DEFAULT 8
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
-- pg_trgm (similarity) lives in the `extensions` schema on Supabase, so it must be on the path for
-- both execution and CREATE-time body validation (SQL-language bodies are parsed at creation).
SET search_path TO 'public', 'extensions'
AS $$
  WITH anchors AS (
    SELECT (e->>'type') AS a_type, (e->>'id')::uuid AS a_id
    FROM jsonb_array_elements(COALESCE(p_anchors, '[]'::jsonb)) e
  ),
  -- 1-hop edges in both directions; neighbor = the OTHER end.
  edges1 AS (
    SELECT a.a_type, a.a_id, 'out'::text AS dir, fe.rel_type::text AS rel,
           fe.dst_type::text AS n_type, fe.dst_id AS n_id
    FROM anchors a
    JOIN public.framework_edges fe
      ON fe.src_type = a.a_type::public.framework_entity_type AND fe.src_id = a.a_id
    UNION ALL
    SELECT a.a_type, a.a_id, 'in'::text, fe.rel_type::text,
           fe.src_type::text, fe.src_id
    FROM anchors a
    JOIN public.framework_edges fe
      ON fe.dst_type = a.a_type::public.framework_entity_type AND fe.dst_id = a.a_id
  ),
  -- Attach neighbor metadata + a goal-relevance score, rank per (anchor, direction).
  ranked AS (
    SELECT e.a_type, e.a_id, e.dir, e.rel, e.n_type, v.id AS n_id, v.slug, v.name, v.description,
           -- narrative-only data: drop {slug,label} ref-arrays (they are the edges) + image arrays.
           (SELECT COALESCE(jsonb_object_agg(k, val), '{}'::jsonb)
              FROM jsonb_each(COALESCE(v.data, '{}'::jsonb)) AS kv(k, val)
             WHERE jsonb_typeof(val) <> 'array') AS narrative,
           GREATEST(
             similarity(coalesce(v.name,''), coalesce(p_query,'')),
             ts_rank(to_tsvector('english', coalesce(v.name,'') || ' ' || coalesce(v.description,'')),
                     websearch_to_tsquery('english', coalesce(p_query,'')))
           ) AS score,
           ROW_NUMBER() OVER (
             PARTITION BY e.a_type, e.a_id, e.dir
             ORDER BY GREATEST(
               similarity(coalesce(v.name,''), coalesce(p_query,'')),
               ts_rank(to_tsvector('english', coalesce(v.name,'') || ' ' || coalesce(v.description,'')),
                       websearch_to_tsquery('english', coalesce(p_query,'')))
             ) DESC NULLS LAST, length(v.name) ASC, v.slug ASC
           ) AS rn
    FROM edges1 e
    JOIN public.framework_entity_v v
      ON v.entity_type = e.n_type AND v.id = e.n_id AND v.is_active
  )
  SELECT COALESCE(jsonb_object_agg(k, payload), '{}'::jsonb)
  FROM (
    SELECT (r.a_type || ':' || r.a_id::text) AS k,
           jsonb_build_object(
             'anchor', (SELECT jsonb_build_object('type', av.entity_type, 'id', av.id, 'slug', av.slug,
                          'name', av.name, 'description', av.description,
                          'data', (SELECT COALESCE(jsonb_object_agg(kk, vv), '{}'::jsonb)
                                     FROM jsonb_each(COALESCE(av.data,'{}'::jsonb)) AS z(kk, vv)
                                    WHERE jsonb_typeof(vv) <> 'array'))
                        FROM public.framework_entity_v av
                        WHERE av.entity_type = r.a_type AND av.id = r.a_id LIMIT 1),
             'neighbors', jsonb_agg(
                jsonb_build_object('dir', r.dir, 'rel', r.rel, 'type', r.n_type, 'id', r.n_id,
                                   'slug', r.slug, 'name', r.name, 'description', r.description,
                                   'data', r.narrative, 'score', round(r.score::numeric, 4))
                ORDER BY r.score DESC NULLS LAST)
           ) AS payload
    FROM ranked r
    WHERE r.rn <= GREATEST(1, LEAST(25, COALESCE(p_per_dir, 8)))
    GROUP BY r.a_type, r.a_id
  ) grouped;
$$;

REVOKE ALL     ON FUNCTION public.fw_graph_context(text, jsonb, integer) FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.fw_graph_context(text, jsonb, integer) TO service_role;

COMMENT ON FUNCTION public.fw_graph_context(text, jsonb, integer) IS
  'A4: goal-ranked, capped, rich-metadata 1-hop neighbor expansion for Fleety. Ranks by relevance to p_query (pg_trgm + FTS); returns neighbor narrative data (non-array fields); relationships stay as edges. 2-hop = caller re-invokes with top neighbors as anchors. service_role only.';
