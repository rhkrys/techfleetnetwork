-- Permanent, authoritative deliverable -> hand-off-component mapping.
--
-- WHICH board node / deliverable feeds WHICH hand-off component is a STORED FACT, reviewed once
-- and read deterministically at generation time. No model ever re-classifies on the hot path.
-- The AI auto-mapper only PROPOSES rows (origin='ai_proposed', approved=false); a human reviews
-- and approves them (approved=true, origin may become 'human' when edited). The generation
-- pipeline reads this table (approved rows) to know exactly where each component's content lives.
CREATE TABLE IF NOT EXISTS public.handoff_source_map (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid NOT NULL,
  phase          text NOT NULL,
  component_slug  text NOT NULL,
  source_label   text NOT NULL,        -- board section / deliverable name (human-readable)
  node_id        text,                  -- Figma/FigJam node id (e.g. "27-5104")
  node_url       text,                  -- deep link to the exact node
  confidence     numeric,               -- auto-mapper confidence 0..1 (NULL for human-authored)
  origin         text NOT NULL DEFAULT 'ai_proposed' CHECK (origin IN ('ai_proposed','human')),
  approved       boolean NOT NULL DEFAULT false,
  created_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, phase, component_slug, source_label)
);
CREATE INDEX IF NOT EXISTS handoff_source_map_lookup
  ON public.handoff_source_map (project_id, phase, component_slug) WHERE approved;

ALTER TABLE public.handoff_source_map ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='handoff_source_map' AND policyname='handoff_map member read') THEN
    CREATE POLICY "handoff_map member read" ON public.handoff_source_map
      FOR SELECT TO authenticated USING (public.handoff_is_active_member(project_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='handoff_source_map' AND policyname='handoff_map member insert') THEN
    CREATE POLICY "handoff_map member insert" ON public.handoff_source_map
      FOR INSERT TO authenticated
      WITH CHECK (public.handoff_is_active_member(project_id) AND created_by = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='handoff_source_map' AND policyname='handoff_map member update') THEN
    CREATE POLICY "handoff_map member update" ON public.handoff_source_map
      FOR UPDATE TO authenticated
      USING (public.handoff_is_active_member(project_id))
      WITH CHECK (public.handoff_is_active_member(project_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='handoff_source_map' AND policyname='handoff_map member delete') THEN
    CREATE POLICY "handoff_map member delete" ON public.handoff_source_map
      FOR DELETE TO authenticated
      USING (public.handoff_is_active_member(project_id) AND created_by = auth.uid());
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.handoff_source_map TO authenticated;
GRANT ALL ON public.handoff_source_map TO service_role;
