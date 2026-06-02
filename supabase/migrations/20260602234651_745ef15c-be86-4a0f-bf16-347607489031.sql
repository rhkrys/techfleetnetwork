
DROP VIEW IF EXISTS public.v_profile_readiness;

CREATE VIEW public.v_profile_readiness
WITH (security_invoker = true)
AS
WITH fields AS (
  SELECT
    p.user_id,
    p.onboarded_at,
    ARRAY[
      ('first_name',              NULLIF(p.first_name, '')               IS NOT NULL),
      ('last_name',               NULLIF(p.last_name, '')                IS NOT NULL),
      ('display_name',            NULLIF(p.display_name, '')             IS NOT NULL),
      ('country',                 NULLIF(p.country, '')                  IS NOT NULL),
      ('timezone',                NULLIF(p.timezone, '')                 IS NOT NULL),
      ('bio',                     NULLIF(p.bio, '')                      IS NOT NULL),
      ('professional_background', NULLIF(p.professional_background, '')  IS NOT NULL),
      ('professional_goals',      NULLIF(p.professional_goals, '')       IS NOT NULL),
      ('avatar_url',              NULLIF(p.avatar_url, '')               IS NOT NULL),
      ('linkedin_url',            NULLIF(p.linkedin_url, '')             IS NOT NULL),
      ('discord_username',        NULLIF(p.discord_username, '')         IS NOT NULL),
      ('interests',               COALESCE(array_length(p.interests, 1), 0) > 0),
      ('experience_areas',        COALESCE(array_length(p.experience_areas, 1), 0) > 0),
      ('education_background',    COALESCE(array_length(p.education_background, 1), 0) > 0)
    ]::record[] AS pairs
  FROM public.profiles p
),
expanded AS (
  SELECT
    f.user_id,
    f.onboarded_at,
    (pair).f1::text    AS field_name,
    (pair).f2::boolean AS present
  FROM fields f,
       LATERAL unnest(f.pairs) AS pair(f1 text, f2 boolean)
)
SELECT
  e.user_id,
  ROUND(100.0 * COUNT(*) FILTER (WHERE e.present) / NULLIF(COUNT(*), 0))::int AS score,
  COALESCE(
    ARRAY_AGG(e.field_name ORDER BY e.field_name) FILTER (WHERE NOT e.present),
    ARRAY[]::text[]
  ) AS missing_fields,
  COUNT(*) FILTER (WHERE e.present)::int AS filled_count,
  COUNT(*)::int                          AS total_count,
  e.onboarded_at
FROM expanded e
GROUP BY e.user_id, e.onboarded_at;

COMMENT ON VIEW public.v_profile_readiness IS
  'Cross-cutting spine §3: single source of truth for profile completeness meter and onboarding nudges. security_invoker=true respects profiles RLS.';

GRANT SELECT ON public.v_profile_readiness TO authenticated;
GRANT SELECT ON public.v_profile_readiness TO service_role;


CREATE OR REPLACE FUNCTION public.journey_progress_block_silent_uncomplete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_allow text;
BEGIN
  IF public.has_role(auth.uid(), 'admin'::app_role) THEN
    RETURN NEW;
  END IF;

  IF (OLD.completed = true AND NEW.completed = false)
     OR (OLD.completed_at IS NOT NULL AND NEW.completed_at IS NULL)
  THEN
    BEGIN
      v_allow := current_setting('app.allow_uncomplete', true);
    EXCEPTION WHEN OTHERS THEN
      v_allow := NULL;
    END;

    IF v_allow IS DISTINCT FROM 'true' THEN
      RAISE EXCEPTION
        'Uncompleting a task requires an explicit confirm action.'
        USING ERRCODE = 'check_violation',
              HINT = 'Use the Mark incomplete confirm dialog (sets app.allow_uncomplete).';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_journey_progress_block_silent_uncomplete ON public.journey_progress;
CREATE TRIGGER trg_journey_progress_block_silent_uncomplete
BEFORE UPDATE ON public.journey_progress
FOR EACH ROW
EXECUTE FUNCTION public.journey_progress_block_silent_uncomplete();

COMMENT ON FUNCTION public.journey_progress_block_silent_uncomplete IS
  'Part 2 §B1: blocks silent task uncompletion. Confirm dialog path must SET LOCAL app.allow_uncomplete = ''true'' in the same transaction.';
