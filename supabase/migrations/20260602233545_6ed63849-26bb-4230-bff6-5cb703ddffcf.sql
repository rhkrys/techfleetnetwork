CREATE OR REPLACE FUNCTION public.respect_notification_prefs()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pref text;
BEGIN
  IF NEW.user_id IS NULL OR NEW.notification_type IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT (notification_prefs ->> NEW.notification_type)
    INTO v_pref
  FROM public.profiles
  WHERE user_id = NEW.user_id;

  IF v_pref = 'off' THEN
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$$;