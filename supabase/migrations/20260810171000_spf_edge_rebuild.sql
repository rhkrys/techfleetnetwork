-- SPF data layer: EDGE REBUILD (ADR-0003). Part of the EXPAND step.
-- Populates the existing framework_edges from spf_entity's {slug,label} link arrays, resolving
-- destinations BY SLUG (robust; SPF gives real slugs) rather than routing SPF's differently-named
-- fields through the name-matching CSV emitter. Edges land in the SAME framework_edges the
-- unchanged neighbor/search MVs + RPCs read. The (src,field)->(rel,dst) mapping is a reviewable
-- data table. Guarded: refuses to run unless active_source='spf', so it can never wipe the
-- reference-sourced edges while the app is still on the old source. No MV refresh here (callers
-- refresh outside a txn — REFRESH ... CONCURRENTLY cannot run inside one).

-- ── The mapping: which SPF link field on which source type becomes which edge ────────────────
-- Only destination types that exist in the framework_entity_type enum AND are loaded as SPF
-- datasets are mapped (the 8 core graph types). Verified field names against the live v1 API.
CREATE TABLE IF NOT EXISTS public.spf_edge_map (
  src_entity_type text NOT NULL,
  spf_field       text NOT NULL,
  rel_type        text NOT NULL,
  dst_entity_type text NOT NULL,
  PRIMARY KEY (src_entity_type, spf_field)
);

INSERT INTO public.spf_edge_map (src_entity_type, spf_field, rel_type, dst_entity_type) VALUES
  -- deliverable →
  ('deliverable', 'Required Skills for the Deliverable',     'requires_skill',    'skill'),
  ('deliverable', 'Required Practices for the Deliverable',  'uses_practice',     'practice'),
  ('deliverable', 'Duty Who Owns the Deliverable',           'owned_by',          'duty'),
  ('deliverable', 'Required Activities',                     'requires_activity', 'activity'),
  ('deliverable', 'Project Milestone Where It''s Delivered', 'part_of',           'project_milestone'),
  ('deliverable', 'Workshops',                               'related_to',        'workshop'),
  -- workshop →
  ('workshop', 'Deliverable the Workshop Produces',          'produces',          'deliverable'),
  ('workshop', 'Practices That This Workshop Teaches',       'uses_practice',     'practice'),
  ('workshop', 'What Duty Runs This Workshop?',              'performed_by',      'duty'),
  ('workshop', 'What Milestone Does This Workshop Belong To?','part_of',          'project_milestone'),
  ('workshop', 'Related Workshop Skills',                    'requires_skill',    'skill'),
  -- skill →
  ('skill', 'Practices Needed to Improve In This Skill',     'uses_practice',     'practice'),
  ('skill', 'Activities Involving the Skill',                'requires_activity', 'activity'),
  ('skill', 'Duties Associated With This Skill',             'performed_by',      'duty'),
  ('skill', 'Team Functions Associated With This Skill',     'part_of',           'job_function'),
  ('skill', 'Milestones',                                    'part_of',           'project_milestone'),
  -- duty →
  ('duty', 'Skills Required For the Duty',                   'requires_skill',    'skill'),
  ('duty', 'Foundational Skills',                            'requires_skill',    'skill'),
  ('duty', 'Activities',                                     'requires_activity', 'activity'),
  ('duty', 'Milestones',                                     'part_of',           'project_milestone'),
  ('duty', 'Practices',                                      'uses_practice',     'practice'),
  ('duty', 'Responsible Deliverables',                       'produces',          'deliverable'),
  ('duty', 'Associated Team Function',                       'part_of',           'job_function'),
  -- activity →
  ('activity', 'Required Hard Skills',                       'requires_skill',    'skill'),
  ('activity', 'Associated Deliverables',                    'produces',          'deliverable'),
  ('activity', 'Duty Who Owns the Activity',                 'owned_by',          'duty'),
  ('activity', 'Milestones',                                 'part_of',           'project_milestone'),
  ('activity', 'Practices',                                  'uses_practice',     'practice'),
  -- job_function →
  ('job_function', 'Practices',                              'uses_practice',     'practice'),
  ('job_function', 'Skills',                                 'requires_skill',    'skill'),
  ('job_function', 'Foundational Skills',                    'requires_skill',    'skill'),
  ('job_function', 'Skills Required for the Role',           'requires_skill',    'skill'),
  ('job_function', 'Required Activities',                    'requires_activity', 'activity'),
  ('job_function', 'Responsible Deliverables',               'produces',          'deliverable'),
  ('job_function', 'Milestones',                             'part_of',           'project_milestone'),
  ('job_function', 'Associated Duties',                      'related_to',        'duty'),
  -- project_milestone →
  ('project_milestone', 'All Deliverables In the Milestone', 'produces',          'deliverable'),
  ('project_milestone', 'UNIQUE Skills in the Milestone',    'requires_skill',    'skill'),
  ('project_milestone', 'UNIQUE Practices',                  'uses_practice',     'practice'),
  ('project_milestone', 'UNIQUE Activities',                 'requires_activity', 'activity'),
  -- practice →
  ('practice', 'Other Practices Required',                   'related_to',        'practice'),
  ('practice', 'UNIQUE Duties Associated with the Practice', 'performed_by',      'duty'),
  ('practice', 'Milestones',                                 'part_of',           'project_milestone')
ON CONFLICT (src_entity_type, spf_field) DO NOTHING;

ALTER TABLE public.spf_edge_map ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.spf_edge_map TO authenticated;
GRANT ALL    ON public.spf_edge_map TO service_role;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='spf_edge_map' AND policyname='spf_edge_map admin read') THEN
    CREATE POLICY "spf_edge_map admin read" ON public.spf_edge_map FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='spf_edge_map' AND policyname='spf_edge_map service writes') THEN
    CREATE POLICY "spf_edge_map service writes" ON public.spf_edge_map FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ── The rebuild: set-based, slug-resolved, guarded ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.spf_rebuild_edges()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE n integer;
BEGIN
  IF public.framework_active_source() <> 'spf' THEN
    RAISE EXCEPTION 'spf_rebuild_edges: refusing to rebuild while active_source=% (flip to spf first)',
      public.framework_active_source();
  END IF;

  DELETE FROM public.framework_edges;
  DELETE FROM public.framework_edge_staging;

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

COMMENT ON FUNCTION public.spf_rebuild_edges() IS
  'Rebuilds framework_edges from spf_entity link arrays (slug-resolved) per spf_edge_map. Guarded to active_source=spf. Callers refresh the neighbor MV afterward (outside a txn).';
