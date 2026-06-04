DROP POLICY IF EXISTS "ugc_translations public read passed" ON public.ugc_translations;

-- Anon can only read translations for the publicly shareable project openings.
-- All other entity_tables (profiles, general_applications, project_applications,
-- announcements, clients) require authentication.
CREATE POLICY "ugc_translations anon read public projects"
  ON public.ugc_translations
  FOR SELECT
  TO anon
  USING (
    status = ANY (ARRAY['qa_passed'::text, 'approved'::text])
    AND entity_table = 'projects'
  );

-- Authenticated members can read any approved/qa_passed translation. The
-- source table's own RLS gates which underlying entity rows they can act on;
-- the translation cache is an additive read.
CREATE POLICY "ugc_translations authenticated read passed"
  ON public.ugc_translations
  FOR SELECT
  TO authenticated
  USING (status = ANY (ARRAY['qa_passed'::text, 'approved'::text]));