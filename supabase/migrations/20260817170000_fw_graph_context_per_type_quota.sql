-- A4 tuning (retrieval-quality PR): fw_graph_context capped neighbors PER DIRECTION only, so a hub
-- node like the Continuous Discovery milestone (29 deliverables + 38 activities + 78 skills + 14
-- workshops = ~159 out-neighbors) crammed ALL types into 6 shared "out" slots. The lexical ranker
-- then favored names containing the query words (problem-statements) and dropped equally-core
-- deliverables whose names don't (research-plan, research-analysis). Fix: quota PER (direction,
-- neighbor type) so deliverables, activities, skills, and workshops each get their own slots and
-- one type can't crowd out another. The 3rd param keeps its name (p_per_dir) since CREATE OR REPLACE
-- cannot rename params and PostgREST calls it by name; only its meaning changes (now per direction+type).
-- Everything else unchanged. No re-run needed after apply (pure function replace); no data change.

-- NOTE: the 3rd param keeps its original NAME p_per_dir (Postgres CREATE OR REPLACE cannot rename a
-- parameter, and the PostgREST call passes it by name) but its MEANING is now "per (direction, type)".
CREATE OR REPLACE FUNCTION public.fw_graph_context(
  p_query   text,
  p_anchors jsonb,                -- [{"type":"duty","id":"<uuid>"}, ...]
  p_per_dir integer DEFAULT 6     -- neighbors kept per (anchor, direction, NEIGHBOR TYPE)
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
  -- Collapse bidirectional edges: a neighbor reached BOTH ways (milestone→produces→deliverable AND
  -- deliverable→part_of→milestone) is ONE neighbor, not two. Keep a single row per neighbor node,
  -- preferring the outgoing direction for phrasing. This also doubles effective unique coverage
  -- (the earlier per-direction scan was showing each neighbor twice, halving the quota).
  edges_dedup AS (
    SELECT DISTINCT ON (a_type, a_id, n_type, n_id) a_type, a_id, dir, rel, n_type, n_id
    FROM edges1
    ORDER BY a_type, a_id, n_type, n_id, (dir = 'out') DESC
  ),
  ranked AS (
    SELECT e.a_type, e.a_id, e.dir, e.rel, e.n_type, v.id AS n_id, v.slug, v.name, v.description,
           (SELECT COALESCE(jsonb_object_agg(k, val), '{}'::jsonb)
              FROM jsonb_each(COALESCE(v.data, '{}'::jsonb)) AS kv(k, val)
             WHERE jsonb_typeof(val) <> 'array') AS narrative,
           GREATEST(
             similarity(coalesce(v.name,''), coalesce(p_query,'')),
             ts_rank(to_tsvector('english', coalesce(v.name,'') || ' ' || coalesce(v.description,'')),
                     websearch_to_tsquery('english', regexp_replace(trim(coalesce(p_query,'')), '\s+', ' or ', 'g')))
           ) AS score,
           ROW_NUMBER() OVER (
             -- quota per (anchor, NEIGHBOR TYPE) — direction already collapsed above. Deliverables,
             -- activities, skills, workshops each get their own slots; none crowds out another.
             PARTITION BY e.a_type, e.a_id, e.n_type
             ORDER BY GREATEST(
               similarity(coalesce(v.name,''), coalesce(p_query,'')),
               ts_rank(to_tsvector('english', coalesce(v.name,'') || ' ' || coalesce(v.description,'')),
                       websearch_to_tsquery('english', regexp_replace(trim(coalesce(p_query,'')), '\s+', ' or ', 'g')))
             ) DESC NULLS LAST, length(v.name) ASC, v.slug ASC
           ) AS rn
    FROM edges_dedup e
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
    -- Full context awareness: a calibrated cap PER object type (completeness where it matters, less
    -- noise where it doesn't). p_per_dir is a CEILING the caller sets — a high value for hop-1 (so the
    -- per-type policy governs) and a small one for hop-2 (so second-level expansion stays bounded).
    WHERE r.rn <= LEAST(
      GREATEST(1, COALESCE(p_per_dir, 25)),
      CASE r.n_type
        -- ANSWER types: 100% coverage. These DEFINE the milestone/role; dropping any drops part of
        -- the answer. 100 = effectively all (real per-anchor counts are ~14-38); headroom for growth.
        WHEN 'deliverable'        THEN 100
        WHEN 'activity'           THEN 100
        WHEN 'workshop'           THEN 100
        WHEN 'duty'               THEN 100  -- all duties + every RACI hat (R/A/C/I)
        -- SUPPORTING types: ranked + capped (all 78 skills of a hub milestone would be noise; the fix
        -- for "are these the right ones" is better RANKING, not a bigger dump).
        WHEN 'skill'              THEN 15
        WHEN 'project_milestone'  THEN 12
        WHEN 'practice'           THEN 10
        WHEN 'job_function'       THEN 10
        WHEN 'specialization'     THEN 10
        WHEN 'methodology'        THEN 10
        WHEN 'tool'               THEN 10
        WHEN 'career_transition'  THEN 10
        WHEN 'practice_component' THEN 10
        WHEN 'job_industry'       THEN 12  -- central for career questions (29 exist); ranking gates it
        WHEN 'project_type'       THEN 8   -- only 5 exist -> shows all; orients to project kind
        WHEN 'project_phase'      THEN 6   -- only 4 exist -> shows all
        WHEN 'company_type'       THEN 6   -- only 4 exist -> shows all
        WHEN 'stakeholder'        THEN 6   -- only 5 exist -> shows all
        WHEN 'data_type'          THEN 6
        ELSE 15                            -- generous default so a NEW type gets real coverage
      END
    )
    GROUP BY r.a_type, r.a_id
  ) grouped;
$$;

REVOKE ALL     ON FUNCTION public.fw_graph_context(text, jsonb, integer) FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.fw_graph_context(text, jsonb, integer) TO service_role;

COMMENT ON FUNCTION public.fw_graph_context(text, jsonb, integer) IS
  'A4: goal-ranked, rich-metadata 1-hop neighbor expansion for Fleety. Quota PER (anchor, direction, neighbor type) so no single type crowds out others. Ranks by relevance to p_query (pg_trgm + FTS); narrative-only data; relationships stay as edges. 2-hop = caller re-invokes with top neighbors. service_role only.';
