
-- Part 2 §B1 — Uncomplete guard on journey_progress
-- Blocks silent completed_at reset; only flips through when the caller opts in
-- via SET LOCAL app.allow_uncomplete = 'true' (the confirm-dialog code path).

CREATE OR REPLACE FUNCTION public.journey_progress_block_silent_uncomplete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_allow text;
BEGIN
  -- Only guard transitions completed=true -> completed=false
  IF OLD.completed = true AND NEW.completed = false THEN
    BEGIN
      v_allow := current_setting('app.allow_uncomplete', true);
    EXCEPTION WHEN OTHERS THEN
      v_allow := NULL;
    END;

    IF v_allow IS DISTINCT FROM 'true' THEN
      RAISE EXCEPTION
        'journey_progress uncomplete blocked: set app.allow_uncomplete=true via the confirm dialog path'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- Defensive: never silently null completed_at while completed stays true
  IF OLD.completed = true AND NEW.completed = true
     AND OLD.completed_at IS NOT NULL AND NEW.completed_at IS NULL THEN
    NEW.completed_at := OLD.completed_at;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_journey_progress_uncomplete_guard ON public.journey_progress;
CREATE TRIGGER trg_journey_progress_uncomplete_guard
  BEFORE UPDATE ON public.journey_progress
  FOR EACH ROW
  EXECUTE FUNCTION public.journey_progress_block_silent_uncomplete();
