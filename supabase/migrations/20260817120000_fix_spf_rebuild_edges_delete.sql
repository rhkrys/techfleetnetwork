-- Fix: spf_rebuild_edges() cleared framework_edges with an UNQUALIFIED DELETE, which prod's
-- sql_safe_updates rejects ("DELETE requires a WHERE clause", SQLSTATE 21000). The rebuild therefore
-- never ran under active_source='spf' — framework_edges was frozen at a stale ~6k (reference-era)
-- and milestones/workshops/duties/practices had ZERO edges, so Fleety couldn't traverse them.
-- Qualify both DELETEs with WHERE true; body otherwise identical. After this, a single
-- SELECT public.spf_rebuild_edges() rebuilds the full directed graph from spf_entity + spf_edge_map
-- (verified in prod 2026-08-17: 6,068 → 14,696 edges; workshop/project_milestone/duty/practice now
-- present). service_role only; guarded to active_source='spf'.

CREATE OR REPLACE FUNCTION public.spf_rebuild_edges()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
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
    src.entity_type::public.framework_entity_type,
    src.id,
    m.rel_type::public.framework_rel_type,
    m.dst_entity_type::public.framework_entity_type,
    dst.id,
    1::smallint,
    'spf'
  FROM public.spf_entity src
  JOIN public.spf_edge_map m ON m.src_entity_type = src.entity_type
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(src.data -> m.spf_field) = 'array' THEN src.data -> m.spf_field ELSE '[]'::jsonb END
  ) AS link
  JOIN public.spf_entity dst
    ON dst.entity_type = m.dst_entity_type
   AND dst.slug = (link ->> 'slug')
   AND dst.is_active
  WHERE src.is_active
    AND NOT (src.entity_type = m.dst_entity_type AND src.id = dst.id)
  ON CONFLICT ON CONSTRAINT framework_edges_unique DO NOTHING;

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END; $$;

REVOKE ALL ON FUNCTION public.spf_rebuild_edges() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.spf_rebuild_edges() TO service_role;
