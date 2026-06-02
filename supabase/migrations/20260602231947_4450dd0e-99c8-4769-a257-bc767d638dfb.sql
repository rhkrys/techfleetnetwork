-- Wave 9: journey_progress uncomplete guard (Part 2 §B1).
-- Blocks accidental `completed → not completed` flips unless the request has
-- opted-in via `set_config('app.allow_uncomplete', 'on', true)` right before
-- the update (the ConfirmDialog path does this; everywhere else does not).

CREATE OR REPLACE FUNCTION public.journey_progress_guard_uncomplete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_allow text;
BEGIN
  -- Only police "completed → not completed" transitions on existing rows.
  IF TG_OP = 'UPDATE'
     AND COALESCE(OLD.completed, false) = true
     AND COALESCE(NEW.completed, false) = false
  THEN
    -- current_setting(..., true) returns '' when unset rather than raising.
    v_allow := current_setting('app.allow_uncomplete', true);
    IF v_allow IS NULL OR lower(v_allow) NOT IN ('on','true','1','yes') THEN
      RAISE EXCEPTION
        'journey_progress: uncompletion blocked; set app.allow_uncomplete=on via the confirm dialog path'
        USING ERRCODE = 'P0001', HINT = 'Use the Mark incomplete ConfirmDialog flow.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_journey_progress_guard_uncomplete ON public.journey_progress;
CREATE TRIGGER trg_journey_progress_guard_uncomplete
  BEFORE UPDATE ON public.journey_progress
  FOR EACH ROW
  EXECUTE FUNCTION public.journey_progress_guard_uncomplete();