-- Wave 13: Auto-derive profiles.display_name (Part 2 §A1)
-- Eliminates redundant profile_updated events caused by users manually
-- syncing display_name to first/last name changes.

CREATE OR REPLACE FUNCTION public.auto_derive_display_name()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_derived TEXT;
  v_first   TEXT := COALESCE(NULLIF(BTRIM(NEW.first_name), ''), '');
  v_last    TEXT := COALESCE(NULLIF(BTRIM(NEW.last_name), ''), '');
BEGIN
  v_derived := BTRIM(v_first || ' ' || v_last);
  IF v_derived = '' THEN
    v_derived := NULL;
  END IF;

  -- On INSERT: set display_name if not provided.
  IF TG_OP = 'INSERT' THEN
    IF NEW.display_name IS NULL OR BTRIM(NEW.display_name) = '' THEN
      NEW.display_name := v_derived;
    END IF;
    RETURN NEW;
  END IF;

  -- On UPDATE: if first/last changed AND display_name was previously the
  -- derived value (i.e. user never customized it), keep it in sync.
  IF TG_OP = 'UPDATE' THEN
    IF (COALESCE(NEW.first_name,'') <> COALESCE(OLD.first_name,'')
        OR COALESCE(NEW.last_name,'') <> COALESCE(OLD.last_name,''))
       AND (
         OLD.display_name IS NULL
         OR BTRIM(OLD.display_name) = ''
         OR BTRIM(OLD.display_name) = BTRIM(COALESCE(OLD.first_name,'') || ' ' || COALESCE(OLD.last_name,''))
       )
       AND (NEW.display_name IS NULL OR BTRIM(NEW.display_name) = BTRIM(OLD.display_name))
    THEN
      NEW.display_name := v_derived;
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_derive_display_name ON public.profiles;
CREATE TRIGGER trg_auto_derive_display_name
  BEFORE INSERT OR UPDATE OF first_name, last_name, display_name
  ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_derive_display_name();

COMMENT ON FUNCTION public.auto_derive_display_name() IS
  'Part 2 §A1: keeps profiles.display_name in sync with first/last unless the user has customized it. Removes need for client to re-write display_name on every name edit.';
