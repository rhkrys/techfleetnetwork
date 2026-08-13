-- Admins can produce hand-offs for ANY project — read side (Phase B3).
--
-- The produce edge function already lets an admin bypass the active-member gate, and admin read
-- policies exist on handoff_productions + handoff_deliverable_submissions. Two stores were missing
-- an admin read policy, so a non-member admin's UI couldn't see the outputs or the retry budget:
--   - handoff_output_files (only member read) → admin couldn't LIST the produced files client-side.
--   - handoff_run_budget (only member read)   → admin couldn't see retries-remaining.
-- This adds admin SELECT to both, matching handoff_prod/feedback/sub. Admins stay subject to the
-- SAME team budget (no bypass) — they produce "just like an active member," for any project.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='handoff_output_files' AND policyname='handoff_out admin read') THEN
    CREATE POLICY "handoff_out admin read" ON public.handoff_output_files
      FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='handoff_run_budget' AND policyname='handoff_budget admin read') THEN
    CREATE POLICY "handoff_budget admin read" ON public.handoff_run_budget
      FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
  END IF;
END $$;
