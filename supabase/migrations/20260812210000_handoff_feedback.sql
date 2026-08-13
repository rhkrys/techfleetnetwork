-- Hand-Off feedback (Phase B3): the post-production review signal.
--
-- After a hand-off is produced, active teammates rate each of the four versions 👍/👎 with an
-- optional note. This is a LEARNING SIGNAL only — it holds nothing back (production is already
-- complete). C11 turns recurring 👎 notes into writer guidance and 👍 outputs into reference
-- exemplars. One rating per (run, version, person), re-rateable (upsert).

CREATE TABLE IF NOT EXISTS public.handoff_feedback (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  production_id uuid NOT NULL REFERENCES public.handoff_productions(id) ON DELETE CASCADE,
  audience      text NOT NULL CHECK (audience IN ('client','teammate','teammate_case_study','org_case_study')),
  rating        text NOT NULL CHECK (rating IN ('up','down')),
  note          text CHECK (note IS NULL OR char_length(note) <= 2000),
  created_by    uuid NOT NULL DEFAULT auth.uid(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (production_id, audience, created_by)
);
CREATE INDEX IF NOT EXISTS handoff_feedback_production_idx
  ON public.handoff_feedback (production_id);

ALTER TABLE public.handoff_feedback ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.handoff_feedback TO authenticated;
GRANT ALL ON public.handoff_feedback TO service_role;

-- Deny-by-default RLS. Active members of the run's project can read all feedback (so the review UI
-- shows what's already there); a member may only write/edit/remove their OWN rating (mass-assignment
-- safe: created_by is always the authenticated user, never a forged value).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='handoff_feedback' AND policyname='handoff_fb member read') THEN
    CREATE POLICY "handoff_fb member read" ON public.handoff_feedback
      FOR SELECT TO authenticated USING (EXISTS (
        SELECT 1 FROM public.handoff_productions p
        WHERE p.id = production_id AND public.handoff_is_active_member(p.project_id)));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='handoff_feedback' AND policyname='handoff_fb author insert') THEN
    CREATE POLICY "handoff_fb author insert" ON public.handoff_feedback
      FOR INSERT TO authenticated WITH CHECK (
        created_by = auth.uid()
        AND EXISTS (SELECT 1 FROM public.handoff_productions p
                    WHERE p.id = production_id AND public.handoff_is_active_member(p.project_id)));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='handoff_feedback' AND policyname='handoff_fb author update') THEN
    CREATE POLICY "handoff_fb author update" ON public.handoff_feedback
      FOR UPDATE TO authenticated USING (created_by = auth.uid()) WITH CHECK (created_by = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='handoff_feedback' AND policyname='handoff_fb author delete') THEN
    CREATE POLICY "handoff_fb author delete" ON public.handoff_feedback
      FOR DELETE TO authenticated USING (created_by = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='handoff_feedback' AND policyname='handoff_fb admin read') THEN
    CREATE POLICY "handoff_fb admin read" ON public.handoff_feedback
      FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
  END IF;
END $$;

COMMENT ON TABLE public.handoff_feedback IS
  'Post-production 👍/👎 + note per (run, version, person). Learning signal only (production is already complete). One rating per person per version per run, re-rateable.';
