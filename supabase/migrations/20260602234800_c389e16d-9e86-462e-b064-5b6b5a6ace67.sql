
CREATE OR REPLACE FUNCTION public.mark_task_incomplete(
  p_phase journey_phase,
  p_task_id text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  -- Whitelist the in-session flag the BEFORE-UPDATE guard looks for.
  PERFORM set_config('app.allow_uncomplete', 'true', true);

  UPDATE public.journey_progress
  SET completed    = false,
      completed_at = NULL,
      updated_at   = now()
  WHERE user_id = v_uid
    AND phase   = p_phase
    AND task_id = p_task_id;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_task_incomplete(journey_phase, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_task_incomplete(journey_phase, text) TO authenticated;

COMMENT ON FUNCTION public.mark_task_incomplete IS
  'Part 2 §B1: only path allowed by trg_journey_progress_block_silent_uncomplete. Confirm-dialog reversals call this RPC.';
