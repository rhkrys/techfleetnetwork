
-- 1) Backfill: any row with completed_at set must be 'completed'
UPDATE public.general_applications
SET status = 'completed'
WHERE completed_at IS NOT NULL
  AND status <> 'completed';

-- 2) Invariant trigger: once completed_at is set, status cannot be reverted to draft
CREATE OR REPLACE FUNCTION public.general_applications_protect_completed_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- If completed_at is set (either already or being set now), force status to 'completed'
  -- when a caller tries to write 'draft'. This neutralizes any late-arriving autosave
  -- payload that hardcodes status='draft'.
  IF COALESCE(NEW.completed_at, OLD.completed_at) IS NOT NULL
     AND NEW.status = 'draft' THEN
    NEW.status := 'completed';
    NEW.completed_at := COALESCE(NEW.completed_at, OLD.completed_at);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_general_applications_protect_completed_status
  ON public.general_applications;

CREATE TRIGGER trg_general_applications_protect_completed_status
BEFORE UPDATE ON public.general_applications
FOR EACH ROW
EXECUTE FUNCTION public.general_applications_protect_completed_status();
