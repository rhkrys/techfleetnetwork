-- Production perf: fw_graph_context recomputed to_tsvector(name||description) LIVE for every neighbor,
-- twice (score + ORDER BY), on every chat turn — the hottest per-turn CPU path. Precompute it:
-- a STORED generated tsvector on spf_entity (regenerated automatically on every swap/insert) + a GIN
-- index, and have fw_graph_context read the ready vector. Also read spf_entity DIRECTLY instead of the
-- framework_entity_v facade — the graph is inherently SPF (framework_edges are spf ids), so the facade
-- indirection bought nothing here and the direct read is cheaper. Behavior is identical; only faster.

ALTER TABLE public.spf_entity
  ADD COLUMN IF NOT EXISTS search_tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('english', coalesce(name, '') || ' ' || coalesce(description, ''))) STORED;
CREATE INDEX IF NOT EXISTS spf_entity_search_tsv_gin ON public.spf_entity USING gin (search_tsv);

CREATE OR REPLACE FUNCTION public.fw_graph_context(
  p_query   text,
  p_anchors jsonb,
  p_per_dir integer DEFAULT 6
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
  WITH anchors AS (
    SELECT (e->>'type') AS a_type, (e->>'id')::uuid AS a_id
    FROM jsonb_array_elements(COALESCE(p_anchors, '[]'::jsonb)) e
  ),
  q AS (SELECT websearch_to_tsquery('english', regexp_replace(trim(coalesce(p_query,'')), '\s+', ' or ', 'g')) AS tsq),
  edges1 AS (
    SELECT a.a_type, a.a_id, 'out'::text AS dir, fe.rel_type::text AS rel,
           fe.dst_type::text AS n_type, fe.dst_id AS n_id, fe.weight AS w
    FROM anchors a
    JOIN public.framework_edges fe
      ON fe.src_type = a.a_type::public.framework_entity_type AND fe.src_id = a.a_id
    UNION ALL
    SELECT a.a_type, a.a_id, 'in'::text, fe.rel_type::text,
           fe.src_type::text, fe.src_id, fe.weight
    FROM anchors a
    JOIN public.framework_edges fe
      ON fe.dst_type = a.a_type::public.framework_entity_type AND fe.dst_id = a.a_id
  ),
  edges_dedup AS (
    SELECT DISTINCT ON (a_type, a_id, n_type, n_id) a_type, a_id, dir, rel, n_type, n_id, w
    FROM edges1
    ORDER BY a_type, a_id, n_type, n_id, (dir = 'out') DESC, w DESC
  ),
  ranked AS (
    SELECT e.a_type, e.a_id, e.dir, e.rel, e.n_type, v.id AS n_id, v.slug, v.name, v.description, e.w,
           (SELECT COALESCE(jsonb_object_agg(k, val), '{}'::jsonb)
              FROM jsonb_each(COALESCE(v.data, '{}'::jsonb)) AS kv(k, val)
             WHERE jsonb_typeof(val) <> 'array') AS narrative,
           GREATEST(similarity(coalesce(v.name,''), coalesce(p_query,'')), ts_rank(v.search_tsv, q.tsq))
             + (GREATEST(e.w,1) - 1)::real AS score,
           ROW_NUMBER() OVER (
             PARTITION BY e.a_type, e.a_id, e.n_type
             ORDER BY
               GREATEST(similarity(coalesce(v.name,''), coalesce(p_query,'')), ts_rank(v.search_tsv, q.tsq))
                 + (GREATEST(e.w,1) - 1)::real DESC NULLS LAST,
               length(v.name) ASC, v.slug ASC
           ) AS rn
    FROM edges_dedup e
    CROSS JOIN q
    JOIN public.spf_entity v
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
                        FROM public.spf_entity av
                        WHERE av.entity_type = r.a_type AND av.id = r.a_id AND av.is_active LIMIT 1),
             'neighbors', jsonb_agg(
                jsonb_build_object('dir', r.dir, 'rel', r.rel, 'type', r.n_type, 'id', r.n_id,
                                   'slug', r.slug, 'name', r.name, 'description', r.description,
                                   'data', r.narrative, 'weight', r.w, 'score', round(r.score::numeric, 4))
                ORDER BY r.score DESC NULLS LAST)
           ) AS payload
    FROM ranked r
    WHERE r.rn <= LEAST(
      GREATEST(1, COALESCE(p_per_dir, 25)),
      CASE r.n_type
        WHEN 'deliverable'        THEN 100
        WHEN 'activity'           THEN 100
        WHEN 'workshop'           THEN 100
        WHEN 'duty'               THEN 100
        WHEN 'skill'              THEN 15
        WHEN 'project_milestone'  THEN 12
        WHEN 'practice'           THEN 10
        WHEN 'job_function'       THEN 10
        WHEN 'specialization'     THEN 10
        WHEN 'methodology'        THEN 10
        WHEN 'tool'               THEN 10
        WHEN 'career_transition'  THEN 10
        WHEN 'practice_component' THEN 10
        WHEN 'job_industry'       THEN 12
        WHEN 'project_type'       THEN 8
        WHEN 'project_phase'      THEN 6
        WHEN 'company_type'       THEN 6
        WHEN 'stakeholder'        THEN 6
        WHEN 'data_type'          THEN 6
        ELSE 15
      END
    )
    GROUP BY r.a_type, r.a_id
  ) grouped;
$$;

REVOKE ALL     ON FUNCTION public.fw_graph_context(text, jsonb, integer) FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.fw_graph_context(text, jsonb, integer) TO service_role;
