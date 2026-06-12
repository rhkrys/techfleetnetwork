-- Admin diagnostic: prove progress integrity by email without exposing internals.
-- Returns per-course (required_lessons, completed_by_member, missing). Admin-only.
CREATE OR REPLACE FUNCTION public.admin_user_progress_snapshot(p_email text)
RETURNS TABLE (
  course_key text,
  phase journey_phase,
  required_lessons bigint,
  user_has_completed bigint,
  missing bigint,
  course_completion_recorded boolean,
  badges_awarded bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_uid uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'admin role required';
  END IF;

  SELECT user_id INTO v_uid FROM public.profiles WHERE lower(email) = lower(p_email) LIMIT 1;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'no profile found for %', p_email;
  END IF;

  RETURN QUERY
  WITH cat AS (
    SELECT lc.course_key, lc.phase, lc.lesson_id
    FROM public.lesson_catalog lc
    WHERE lc.active AND lc.required
  ),
  prog AS (
    SELECT jp.phase, jp.task_id
    FROM public.journey_progress jp
    WHERE jp.user_id = v_uid AND jp.completed = true
  )
  SELECT
    c.course_key,
    c.phase,
    count(*)::bigint AS required_lessons,
    count(p.task_id)::bigint AS user_has_completed,
    count(*) FILTER (WHERE p.task_id IS NULL)::bigint AS missing,
    EXISTS (SELECT 1 FROM public.course_completions cc WHERE cc.user_id = v_uid AND cc.course_key = c.course_key) AS course_completion_recorded,
    (SELECT count(*) FROM public.badges_awarded ba WHERE ba.user_id = v_uid AND ba.course_key = c.course_key)::bigint AS badges_awarded
  FROM cat c
  LEFT JOIN prog p ON p.phase = c.phase AND p.task_id = c.lesson_id
  GROUP BY c.course_key, c.phase
  ORDER BY c.course_key;
END
$$;

REVOKE ALL ON FUNCTION public.admin_user_progress_snapshot(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_user_progress_snapshot(text) TO authenticated, service_role;