-- Hand-Off degraded-arc surfacing (Phase B2 reliability).
--
-- The writer degrades a failed story arc to the renderer's honest "_Awaiting content._" placeholder
-- rather than failing the whole run (graceful degradation — a partial hand-off beats none). But the
-- run was then marked 'complete' + is_latest with NO record that it shipped with gaps, so:
--   (a) it silently violated the @reliability "never half-produce silently" intent, and
--   (b) the "all 4 versions valid" correctness SLO was unmeasurable (nothing to query).
-- This adds a first-class gap_count the worker records at completion, so a degraded hand-off is
-- visible to operators, the SLO, and (later) the UI — WITHOUT failing the run.
--
-- Expand-only: additive column with a safe default; handoff_complete_run gains a trailing
-- p_gap_count param that DEFAULTS to 0, so any existing 2-arg caller keeps working unchanged.

ALTER TABLE public.handoff_productions
  ADD COLUMN IF NOT EXISTS gap_count integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.handoff_productions.gap_count IS
  'Count of story-arc components that shipped as "_Awaiting content._" placeholders (a degraded arc '
  'the writer could not produce). 0 = clean run; >0 = complete-with-gaps. Set at completion by the '
  'worker; the "all versions valid" SLO reads this. Not a failure — the run still completed.';

-- Drop the 2-arg signature so there is exactly ONE handoff_complete_run overload, then recreate it
-- with the trailing p_gap_count (DEFAULT 0 keeps 2-arg call sites valid). Storing gap_count in the
-- SAME atomic update as the status flip keeps the completion record self-consistent.
DROP FUNCTION IF EXISTS public.handoff_complete_run(uuid, text);

CREATE OR REPLACE FUNCTION public.handoff_complete_run(
  p_run_id uuid, p_worker_id text, p_gap_count integer DEFAULT 0
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_pid uuid; v_phase public.project_phase; v_rows integer;
BEGIN
  UPDATE public.handoff_productions SET
    status = 'complete', gap_count = GREATEST(p_gap_count, 0),
    worker_id = NULL, lease_expires_at = NULL, pipeline_state = NULL, updated_at = now()
  WHERE id = p_run_id AND worker_id = p_worker_id
  RETURNING project_id, phase INTO v_pid, v_phase;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN RETURN false; END IF;
  UPDATE public.handoff_productions SET is_latest = false, updated_at = now()
  WHERE project_id = v_pid AND phase = v_phase AND id <> p_run_id AND is_latest;
  RETURN true;
END $$;

-- Service-role only (the worker holds the service key); re-assert after the signature change.
REVOKE ALL ON FUNCTION public.handoff_complete_run(uuid, text, integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handoff_complete_run(uuid, text, integer) TO service_role;
