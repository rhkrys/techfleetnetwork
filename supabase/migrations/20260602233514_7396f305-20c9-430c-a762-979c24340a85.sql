-- F1: Notification preferences (opt-out per kind), enforced server-side via trigger.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS notification_prefs jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.profiles.notification_prefs IS
  'Per-kind notification opt-out map: { "<kind>": "on"|"off" }. Missing key = on.';

CREATE OR REPLACE FUNCTION public.respect_notification_prefs()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pref text;
BEGIN
  IF NEW.user_id IS NULL OR NEW.type IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT (notification_prefs ->> NEW.type)
    INTO v_pref
  FROM public.profiles
  WHERE user_id = NEW.user_id;

  IF v_pref = 'off' THEN
    -- Silently drop: producer code stays untouched, member opt-out wins.
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS respect_notification_prefs_before_insert ON public.notifications;
CREATE TRIGGER respect_notification_prefs_before_insert
BEFORE INSERT ON public.notifications
FOR EACH ROW
EXECUTE FUNCTION public.respect_notification_prefs();