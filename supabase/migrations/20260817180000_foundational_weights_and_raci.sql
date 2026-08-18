-- Retrieval quality: (1) FOUNDATIONAL-IMPORTANCE ranking + (2) true RACI relation types.
--
-- (1) Lexical ranking can't tell a foundational skill from an incidental one. But the SPF already
-- encodes importance in its "Foundational Skills" / "First Step(s)" fields. Give those edges a higher
-- weight at rebuild and have fw_graph_context rank by relevance + foundational-weight, so the
-- framework's OWN notion of foundational floats to the top of the supporting-type lists.
--
-- (2) RACI was collapsed into performed_by (R+A) and related_to (C+I), so Fleety saw WHICH duties but
-- not their hat. Add distinct responsible/accountable/consulted/informed relation types and remap the
-- RACI fields to them, so Fleety can teach cross-functional dynamics with the actual hats.
--
-- ENUM ADD VALUEs must COMMIT before the rebuild uses them (separate txns) — the apply script runs the
-- enum adds first, then this file's remaining statements. Idempotent.

-- ── (2a) RACI relation types ─────────────────────────────────────────────────
ALTER TYPE public.framework_rel_type ADD VALUE IF NOT EXISTS 'responsible';
ALTER TYPE public.framework_rel_type ADD VALUE IF NOT EXISTS 'accountable';
ALTER TYPE public.framework_rel_type ADD VALUE IF NOT EXISTS 'consulted';
ALTER TYPE public.framework_rel_type ADD VALUE IF NOT EXISTS 'informed';

-- ── (1a) edge-map weight column (foundational importance) ────────────────────
ALTER TABLE public.spf_edge_map ADD COLUMN IF NOT EXISTS weight smallint NOT NULL DEFAULT 1;

-- ── (1b) mark foundational fields weight 3 ("Foundational…" and "First Step(s)…") ──
UPDATE public.spf_edge_map SET weight = 3
 WHERE spf_field ILIKE '%foundational%' OR spf_field ILIKE 'first step%';

-- ── (2b) remap RACI fields to their distinct hats ────────────────────────────
-- Guard: exclude deliverable-targeting fields like "Responsible Deliverables" (that's ownership/
-- production, kept as 'produces'), not a RACI hat. RACI hats point at activities/duties/functions.
UPDATE public.spf_edge_map SET rel_type = 'responsible'
 WHERE spf_field ILIKE '%responsible%' AND dst_entity_type <> 'deliverable';
UPDATE public.spf_edge_map SET rel_type = 'accountable'
 WHERE spf_field ILIKE '%accountable%' AND dst_entity_type <> 'deliverable';
UPDATE public.spf_edge_map SET rel_type = 'consulted'
 WHERE spf_field ILIKE '%consulted%' AND dst_entity_type <> 'deliverable';
UPDATE public.spf_edge_map SET rel_type = 'informed'
 WHERE spf_field ILIKE '%informed%' AND dst_entity_type <> 'deliverable';

-- ── (1c) rebuild carries the map weight (was hardcoded 1) ────────────────────
CREATE OR REPLACE FUNCTION public.spf_rebuild_edges()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE n integer;
BEGIN
  IF public.framework_active_source() <> 'spf' THEN
    RAISE EXCEPTION 'spf_rebuild_edges: refusing to rebuild while active_source=% (flip to spf first)',
      public.framework_active_source();
  END IF;
  DELETE FROM public.framework_edges WHERE true;
  DELETE FROM public.framework_edge_staging WHERE true;
  INSERT INTO public.framework_edges (src_type, src_id, rel_type, dst_type, dst_id, weight, source)
  SELECT DISTINCT
    src.entity_type::public.framework_entity_type, src.id,
    m.rel_type::public.framework_rel_type, m.dst_entity_type::public.framework_entity_type, dst.id,
    m.weight::smallint, 'spf'
  FROM public.spf_entity src
  JOIN public.spf_edge_map m ON m.src_entity_type = src.entity_type
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(src.data -> m.spf_field) = 'array' THEN src.data -> m.spf_field ELSE '[]'::jsonb END
  ) AS link
  JOIN public.spf_entity dst
    ON dst.entity_type = m.dst_entity_type AND dst.slug = (link ->> 'slug') AND dst.is_active
  WHERE src.is_active AND NOT (src.entity_type = m.dst_entity_type AND src.id = dst.id)
  ON CONFLICT ON CONSTRAINT framework_edges_unique DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END; $fn$;

-- ── (1d) fw_graph_context: rank by relevance + foundational weight ───────────
-- Weight rides through edges1 -> dedup (prefer the higher-weight edge) -> ranked, where the ORDER BY
-- adds (weight-1) so a foundational (weight 3) neighbor sorts above an incidental (weight 1) one even
-- when lexical relevance ties. Per-type caps + OR-matched FTS unchanged.
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
           GREATEST(
             similarity(coalesce(v.name,''), coalesce(p_query,'')),
             ts_rank(to_tsvector('english', coalesce(v.name,'') || ' ' || coalesce(v.description,'')),
                     websearch_to_tsquery('english', regexp_replace(trim(coalesce(p_query,'')), '\s+', ' or ', 'g')))
           ) + (GREATEST(e.w,1) - 1)::real AS score,
           ROW_NUMBER() OVER (
             PARTITION BY e.a_type, e.a_id, e.n_type
             ORDER BY
               GREATEST(
                 similarity(coalesce(v.name,''), coalesce(p_query,'')),
                 ts_rank(to_tsvector('english', coalesce(v.name,'') || ' ' || coalesce(v.description,'')),
                         websearch_to_tsquery('english', regexp_replace(trim(coalesce(p_query,'')), '\s+', ' or ', 'g')))
               ) + (GREATEST(e.w,1) - 1)::real DESC NULLS LAST,
               length(v.name) ASC, v.slug ASC
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
