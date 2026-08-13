-- Hand-Off Production System: INTAKE + COMPLETENESS GATE (Phase B1).
-- Active teammates upload/link deliverables per hand-off component; the strict gate (ALL 26
-- components present) unlocks production. The 26 components are the SPF handoff-deliverables-map
-- (entity_type='handoff_component' in spf_entity, loaded in A1) — SPF-native, so this reads
-- spf_entity directly regardless of the framework source flag. No production/LLM here (B2).

-- ── Membership helper: "active teammate on this project" (project_applications) ──────────────
-- SECURITY DEFINER so RLS policies + RPCs can check membership without exposing the whole table.
CREATE OR REPLACE FUNCTION public.handoff_is_active_member(p_project_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.project_applications pa
    WHERE pa.project_id = p_project_id
      AND pa.user_id = auth.uid()
      AND pa.applicant_status = 'active_participant'
  );
$$;
REVOKE ALL ON FUNCTION public.handoff_is_active_member(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.handoff_is_active_member(uuid) TO authenticated, service_role;

-- ── Submissions: one row per uploaded file / text entry / link, tagged to a component ────────
CREATE TABLE IF NOT EXISTS public.handoff_deliverable_submissions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  phase           public.project_phase NOT NULL,
  component_slug  text NOT NULL,                 -- SPF handoff_component slug, e.g. 'pre-amble-4'
  submission_type text NOT NULL CHECK (submission_type IN ('file','text','figma','figjam','url')),
  text_content    text CHECK (text_content IS NULL OR char_length(text_content) <= 10000),
  file_path       text,                          -- path in the handoff-deliverables bucket
  file_name       text,
  external_url    text,
  created_by      uuid NOT NULL DEFAULT auth.uid(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  -- exactly one payload kind must be present for its type
  CONSTRAINT handoff_submission_payload CHECK (
    (submission_type = 'text'  AND text_content IS NOT NULL AND file_path IS NULL AND external_url IS NULL) OR
    (submission_type = 'file'  AND file_path   IS NOT NULL AND text_content IS NULL AND external_url IS NULL) OR
    (submission_type IN ('figma','figjam','url') AND external_url IS NOT NULL AND file_path IS NULL AND text_content IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS handoff_sub_project_phase_idx
  ON public.handoff_deliverable_submissions (project_id, phase, component_slug);

ALTER TABLE public.handoff_deliverable_submissions ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, DELETE ON public.handoff_deliverable_submissions TO authenticated;
GRANT ALL ON public.handoff_deliverable_submissions TO service_role;

DO $$
BEGIN
  -- Any active teammate on the project may read submissions for that project.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='handoff_deliverable_submissions' AND policyname='handoff_sub member read') THEN
    CREATE POLICY "handoff_sub member read" ON public.handoff_deliverable_submissions
      FOR SELECT TO authenticated USING (public.handoff_is_active_member(project_id));
  END IF;
  -- Any active teammate may upload for ANY component of their project (per requirements).
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='handoff_deliverable_submissions' AND policyname='handoff_sub member insert') THEN
    CREATE POLICY "handoff_sub member insert" ON public.handoff_deliverable_submissions
      FOR INSERT TO authenticated
      WITH CHECK (public.handoff_is_active_member(project_id) AND created_by = auth.uid());
  END IF;
  -- A teammate may remove a submission they created (fix a wrong upload).
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='handoff_deliverable_submissions' AND policyname='handoff_sub owner delete') THEN
    CREATE POLICY "handoff_sub owner delete" ON public.handoff_deliverable_submissions
      FOR DELETE TO authenticated USING (public.handoff_is_active_member(project_id) AND created_by = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='handoff_deliverable_submissions' AND policyname='handoff_sub admin all') THEN
    CREATE POLICY "handoff_sub admin all" ON public.handoff_deliverable_submissions
      FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
  END IF;
END $$;

-- ── Private storage bucket for uploaded deliverable files ────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'handoff-deliverables', 'handoff-deliverables', false, 52428800,  -- 50 MB cap
  ARRAY['application/pdf','image/png','image/jpeg','text/csv','text/plain',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-excel',
        'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document']
)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  -- Path convention: {project_id}/{phase}/{component_slug}/{file}. First folder = project_id.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='handoff deliverables member read') THEN
    CREATE POLICY "handoff deliverables member read" ON storage.objects
      FOR SELECT TO authenticated
      USING (bucket_id='handoff-deliverables' AND public.handoff_is_active_member((split_part(name,'/',1))::uuid));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='handoff deliverables member write') THEN
    CREATE POLICY "handoff deliverables member write" ON storage.objects
      FOR INSERT TO authenticated
      WITH CHECK (bucket_id='handoff-deliverables' AND public.handoff_is_active_member((split_part(name,'/',1))::uuid));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='handoff deliverables member delete') THEN
    CREATE POLICY "handoff deliverables member delete" ON storage.objects
      FOR DELETE TO authenticated
      USING (bucket_id='handoff-deliverables' AND public.handoff_is_active_member((split_part(name,'/',1))::uuid));
  END IF;
END $$;

-- ── The strict completeness gate: progress + per-component status + ready flag ───────────────
-- Reads the 26 components from the SPF snapshot; a component is "complete" if it has >=1
-- submission (file OR text OR link) for this project+phase. is_ready = all 26 present.
-- SECURITY INVOKER: submissions RLS scopes what the caller sees; spf_entity is public.
CREATE OR REPLACE FUNCTION public.handoff_completeness(p_project_id uuid, p_phase public.project_phase)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH comp AS (
    SELECT c.slug,
           (c.data ->> 'Component')          AS component,
           (c.data ->> 'Hand-Off Story Arc') AS story_arc,
           EXISTS (
             SELECT 1 FROM public.handoff_deliverable_submissions s
             WHERE s.project_id = p_project_id AND s.phase = p_phase AND s.component_slug = c.slug
           ) AS is_complete
    FROM public.spf_entity c
    WHERE c.entity_type = 'handoff_component' AND c.is_active
  )
  SELECT jsonb_build_object(
    'total',      count(*),
    'completed',  count(*) FILTER (WHERE is_complete),
    'progress_pct', CASE WHEN count(*)=0 THEN 0
                         ELSE round(100.0 * count(*) FILTER (WHERE is_complete) / count(*)) END,
    'is_ready',   count(*) > 0 AND count(*) = count(*) FILTER (WHERE is_complete),
    'components', jsonb_agg(jsonb_build_object(
                    'slug', slug, 'component', component, 'story_arc', story_arc, 'complete', is_complete
                  ) ORDER BY slug)
  )
  FROM comp;
$$;
REVOKE ALL ON FUNCTION public.handoff_completeness(uuid, public.project_phase) FROM public;
GRANT EXECUTE ON FUNCTION public.handoff_completeness(uuid, public.project_phase) TO authenticated, service_role;

COMMENT ON FUNCTION public.handoff_completeness(uuid, public.project_phase) IS
  'Strict 26-component hand-off completeness gate (Phase B1). is_ready=true only when every SPF handoff_component has >=1 submission for the project+phase.';
