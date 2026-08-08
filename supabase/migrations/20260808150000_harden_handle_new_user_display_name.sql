-- Fix: handle_new_user() could insert a NULL display_name for a user with no
-- name metadata (e.g. an email/password signup with no first/last/full name),
-- violating profiles.display_name NOT NULL → GoTrue returns "Database error
-- creating new user" (HTTP 500). Surfaced on a fresh DB once db reset began
-- applying the auth->profile trigger end-to-end (audit H3/H4 follow-on); it is
-- also a latent PRODUCTION signup failure for any nameless signup.
--
-- Fix: make every NOT NULL text column provably non-null at the INSERT, with a
-- display_name that falls back name → email → 'Member' (never NULL/blank).
-- This is the new latest definition of the function, so it is what runs.
-- Idempotent (CREATE OR REPLACE); trigger attachment unchanged.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_first_name text;
  v_last_name text;
  v_display_name text;
  v_email text;
  v_birth_year smallint;
BEGIN
  v_first_name := COALESCE(
    NEW.raw_user_meta_data->>'first_name',
    NEW.raw_user_meta_data->>'given_name',
    ''
  );
  v_last_name := COALESCE(
    NEW.raw_user_meta_data->>'last_name',
    NEW.raw_user_meta_data->>'family_name',
    ''
  );
  v_email := COALESCE(NEW.email, '');
  -- display_name is NOT NULL: guarantee a non-null, non-blank value.
  v_display_name := COALESCE(
    NULLIF(NEW.raw_user_meta_data->>'full_name', ''),
    NULLIF(NEW.raw_user_meta_data->>'name', ''),
    NULLIF(TRIM(v_first_name || ' ' || v_last_name), ''),
    NULLIF(v_email, ''),
    'Member'
  );

  BEGIN
    v_birth_year := NULLIF(NEW.raw_user_meta_data->>'birth_year','')::smallint;
    IF v_birth_year IS NOT NULL AND (v_birth_year < 1900 OR v_birth_year > EXTRACT(YEAR FROM now())::int) THEN
      v_birth_year := NULL;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_birth_year := NULL;
  END;

  INSERT INTO public.profiles (user_id, first_name, last_name, display_name, email, birth_year)
  VALUES (NEW.id, v_first_name, v_last_name, v_display_name, v_email, v_birth_year);
  RETURN NEW;
END;
$function$;
