CREATE OR REPLACE FUNCTION public.recompute_all_stats()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_total_signups bigint;
  v_core_total bigint; v_onb_total bigint; v_all_courses_total bigint;
  v_apps_total bigint; v_discord_total bigint; v_badges_total bigint;
  v_pw_start date := (current_date - interval '7 days')::date;
  v_pw_end date := current_date;
  v_pw_signups bigint;
  v_pw_core bigint; v_pw_onb bigint; v_pw_all_courses bigint;
  v_pw_apps bigint; v_pw_discord bigint; v_pw_badges bigint;
BEGIN
  IF NOT pg_try_advisory_xact_lock(8675309) THEN
    RETURN jsonb_build_object('skipped', true);
  END IF;

  WITH per_user_course AS (
    SELECT jp.user_id, lc.course_key,
           count(DISTINCT jp.task_id) AS done,
           max(jp.completed_at) AS max_at
    FROM public.journey_progress jp
    JOIN public.lesson_catalog lc ON lc.lesson_id = jp.task_id AND lc.active AND lc.required
    WHERE jp.completed = true
    GROUP BY jp.user_id, lc.course_key
  ),
  course_req AS (
    SELECT course_key, count(*) AS req
    FROM public.lesson_catalog WHERE active AND required GROUP BY course_key
  )
  INSERT INTO public.course_completions (user_id, course_key, completed_at)
  SELECT puc.user_id, puc.course_key, COALESCE(puc.max_at, now())
  FROM per_user_course puc
  JOIN course_req cr ON cr.course_key = puc.course_key
  WHERE puc.done >= cr.req
  ON CONFLICT (user_id, course_key) DO NOTHING;

  INSERT INTO public.general_application_submissions (user_id, submitted_at, application_id)
  SELECT DISTINCT ON (user_id) user_id, COALESCE(completed_at, updated_at), id
  FROM public.general_applications
  WHERE status = 'completed'
  ORDER BY user_id, COALESCE(completed_at, updated_at) ASC
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.badges_awarded (user_id, badge_code, source, source_id, awarded_at)
  SELECT user_id, 'course_completed:' || course_key, 'course_completion', id::text, completed_at
  FROM public.course_completions
  ON CONFLICT (user_id, badge_code, source_id) DO NOTHING;

  INSERT INTO public.badges_awarded (user_id, badge_code, source, source_id, awarded_at)
  SELECT user_id, 'application_submitted', 'general_application', id::text, submitted_at
  FROM public.general_application_submissions
  ON CONFLICT (user_id, badge_code, source_id) DO NOTHING;

  INSERT INTO public.badges_awarded (user_id, badge_code, source, source_id, awarded_at)
  SELECT p.user_id, 'discord_linked', 'profile', p.user_id::text,
         COALESCE(p.discord_linked_at, p.created_at, now())
  FROM public.profiles p
  WHERE p.discord_user_id IS NOT NULL AND p.discord_user_id <> ''
  ON CONFLICT (user_id, badge_code, source_id) DO NOTHING;

  SELECT count(*) INTO v_total_signups FROM public.profiles WHERE NOT is_test_account;

  SELECT count(*) INTO v_core_total
    FROM public.course_completions cc
    JOIN public.course_catalog cat ON cat.course_key = cc.course_key
    JOIN public.profiles p ON p.user_id = cc.user_id
    WHERE cat.tier = 'core' AND NOT p.is_test_account;

  SELECT count(*) INTO v_onb_total
    FROM public.course_completions cc
    JOIN public.course_catalog cat ON cat.course_key = cc.course_key
    JOIN public.profiles p ON p.user_id = cc.user_id
    WHERE cat.tier = 'onboarding' AND NOT p.is_test_account;

  SELECT count(*) INTO v_all_courses_total
    FROM public.course_completions cc
    JOIN public.profiles p ON p.user_id = cc.user_id
    WHERE NOT p.is_test_account;

  SELECT count(*) INTO v_apps_total
    FROM public.general_application_submissions s
    JOIN public.profiles p ON p.user_id = s.user_id
    WHERE NOT p.is_test_account;

  SELECT count(*) INTO v_discord_total
    FROM public.profiles p
    WHERE NOT p.is_test_account
      AND p.discord_user_id IS NOT NULL
      AND p.discord_user_id <> ''
      AND p.discord_linked_at IS NOT NULL;

  v_badges_total := v_all_courses_total + v_apps_total + v_discord_total;

  SELECT count(*) INTO v_pw_signups FROM public.profiles
    WHERE NOT is_test_account AND created_at::date >= v_pw_start AND created_at::date < v_pw_end;

  SELECT count(*) INTO v_pw_core FROM public.course_completions cc
    JOIN public.course_catalog cat ON cat.course_key = cc.course_key
    JOIN public.profiles p ON p.user_id = cc.user_id
    WHERE cat.tier = 'core' AND NOT p.is_test_account
      AND cc.completed_at::date >= v_pw_start AND cc.completed_at::date < v_pw_end;

  SELECT count(*) INTO v_pw_onb FROM public.course_completions cc
    JOIN public.course_catalog cat ON cat.course_key = cc.course_key
    JOIN public.profiles p ON p.user_id = cc.user_id
    WHERE cat.tier = 'onboarding' AND NOT p.is_test_account
      AND cc.completed_at::date >= v_pw_start AND cc.completed_at::date < v_pw_end;

  SELECT count(*) INTO v_pw_all_courses FROM public.course_completions cc
    JOIN public.profiles p ON p.user_id = cc.user_id
    WHERE NOT p.is_test_account
      AND cc.completed_at::date >= v_pw_start AND cc.completed_at::date < v_pw_end;

  SELECT count(*) INTO v_pw_apps FROM public.general_application_submissions s
    JOIN public.profiles p ON p.user_id = s.user_id
    WHERE NOT p.is_test_account
      AND s.submitted_at::date >= v_pw_start AND s.submitted_at::date < v_pw_end;

  SELECT count(*) INTO v_pw_discord FROM public.profiles p
    WHERE NOT p.is_test_account
      AND p.discord_user_id IS NOT NULL
      AND p.discord_user_id <> ''
      AND p.discord_linked_at::date >= v_pw_start
      AND p.discord_linked_at::date < v_pw_end;

  v_pw_badges := v_pw_all_courses + v_pw_apps + v_pw_discord;

  INSERT INTO public.network_stats_snapshots(scope, metric_key, value, computed_at) VALUES
    ('all_time','total_signups',v_total_signups,now()),
    ('all_time','core_course_completions_total',v_core_total,now()),
    ('all_time','onboarding_course_completions_total',v_onb_total,now()),
    ('all_time','all_course_completions_total',v_all_courses_total,now()),
    ('all_time','general_applications_total',v_apps_total,now()),
    ('all_time','discord_links_total',v_discord_total,now()),
    ('all_time','badges_earned_total',v_badges_total,now()),
    ('past_7d','total_signups',v_pw_signups,now()),
    ('past_7d','core_course_completions_total',v_pw_core,now()),
    ('past_7d','onboarding_course_completions_total',v_pw_onb,now()),
    ('past_7d','all_course_completions_total',v_pw_all_courses,now()),
    ('past_7d','general_applications_total',v_pw_apps,now()),
    ('past_7d','discord_links_total',v_pw_discord,now()),
    ('past_7d','badges_earned_total',v_pw_badges,now())
  ON CONFLICT (scope, metric_key) DO UPDATE SET value = EXCLUDED.value, computed_at = now();

  INSERT INTO public.course_completion_stats (course_key, total_completions, past_7d_completions, computed_at)
  SELECT cc.course_key, count(*),
         count(*) FILTER (WHERE cc.completed_at::date >= v_pw_start AND cc.completed_at::date < v_pw_end),
         now()
  FROM public.course_completions cc
  JOIN public.profiles p ON p.user_id = cc.user_id
  WHERE NOT p.is_test_account
  GROUP BY cc.course_key
  ON CONFLICT (course_key) DO UPDATE SET
    total_completions = EXCLUDED.total_completions,
    past_7d_completions = EXCLUDED.past_7d_completions,
    computed_at = now();

  INSERT INTO public.course_completion_stats (course_key, total_completions, past_7d_completions, computed_at)
  SELECT cc.course_key, 0, 0, now() FROM public.course_catalog cc
  ON CONFLICT (course_key) DO NOTHING;

  RETURN jsonb_build_object('ok', true,
    'total_signups', v_total_signups,
    'core_course_completions_total', v_core_total,
    'onboarding_course_completions_total', v_onb_total,
    'all_course_completions_total', v_all_courses_total,
    'general_applications_total', v_apps_total,
    'discord_links_total', v_discord_total,
    'badges_earned_total', v_badges_total,
    'past_7d_badges_earned_total', v_pw_badges);
END $$;

REVOKE EXECUTE ON FUNCTION public.recompute_all_stats() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_all_stats() TO service_role;

DROP FUNCTION IF EXISTS public.get_network_stats();
CREATE OR REPLACE FUNCTION public.get_network_stats()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
WITH s AS (SELECT metric_key, value FROM public.network_stats_snapshots WHERE scope = 'all_time'),
pw AS (SELECT metric_key, value FROM public.network_stats_snapshots WHERE scope = 'past_7d'),
o  AS (SELECT metric_key, value FROM public.network_stats_overrides),
h  AS (SELECT metric_key, value, last_synced_at FROM public.network_stats_historical),
proj AS (
  SELECT
    count(*) FILTER (WHERE LOWER(project_status::text) = 'apply_now') AS open_apps,
    count(*) FILTER (WHERE LOWER(project_status::text) IN ('coming_soon','recruiting','team_onboarding')) AS coming_soon
  FROM public.projects
),
dcc AS (
  SELECT count(DISTINCT cc.user_id) AS n
  FROM public.course_completions cc
  JOIN public.profiles p ON p.user_id = cc.user_id
  WHERE COALESCE(p.is_test_account, false) = false
)
SELECT jsonb_build_object(
  'total_signups',                 COALESCE((SELECT value FROM s WHERE metric_key='total_signups'), 0),
  'course_completions_total',      COALESCE((SELECT value FROM s WHERE metric_key='all_course_completions_total'), 0),
  'core_courses_active',           COALESCE((SELECT value FROM s WHERE metric_key='core_course_completions_total'), 0),
  'onboarding_courses_active',     COALESCE((SELECT value FROM s WHERE metric_key='onboarding_course_completions_total'), 0),
  'discord_links_count',           COALESCE((SELECT value FROM s WHERE metric_key='discord_links_total'), 0),
  'distinct_course_completers',    COALESCE((SELECT n FROM dcc), 0),
  'beginner_courses_active',       COALESCE((SELECT value FROM o WHERE metric_key='beginner_courses_active'), 0),
  'advanced_courses_active',       COALESCE((SELECT value FROM o WHERE metric_key='advanced_courses_active'), 0),
  'applications_completed',        COALESCE((SELECT value FROM s WHERE metric_key='general_applications_total'), 0),
  'badges_earned',                 COALESCE((SELECT value FROM s WHERE metric_key='badges_earned_total'), 0),
  'prev_week_start',               to_char((current_date - interval '7 days')::date, 'YYYY-MM-DD'),
  'prev_week_end',                 to_char(current_date, 'YYYY-MM-DD'),
  'prev_week_signups',             COALESCE((SELECT value FROM pw WHERE metric_key='total_signups'), 0),
  'prev_week_course_completions_total', COALESCE((SELECT value FROM pw WHERE metric_key='all_course_completions_total'), 0),
  'prev_week_core_active',         COALESCE((SELECT value FROM pw WHERE metric_key='core_course_completions_total'), 0),
  'prev_week_onboarding_active',   COALESCE((SELECT value FROM pw WHERE metric_key='onboarding_course_completions_total'), 0),
  'prev_week_discord_links_count', COALESCE((SELECT value FROM pw WHERE metric_key='discord_links_total'), 0),
  'prev_week_beginner_active',     COALESCE((SELECT value FROM o WHERE metric_key='prev_week_beginner_active'), 0),
  'prev_week_advanced_active',     COALESCE((SELECT value FROM o WHERE metric_key='prev_week_advanced_active'), 0),
  'prev_week_applications',        COALESCE((SELECT value FROM pw WHERE metric_key='general_applications_total'), 0),
  'prev_week_badges',              COALESCE((SELECT value FROM pw WHERE metric_key='badges_earned_total'), 0),
  'projects_open_applications',    (SELECT open_apps FROM proj),
  'projects_coming_soon',          (SELECT coming_soon FROM proj),
  'projects_live',                 COALESCE((SELECT value FROM o WHERE metric_key='projects_live'), 0),
  'projects_previously_completed', COALESCE((SELECT value FROM o WHERE metric_key='projects_previously_completed'), 0),
  'historical', jsonb_build_object(
    'general_applications_pre_platform', COALESCE((SELECT value FROM h WHERE metric_key='general_applications_pre_platform'), 0),
    'service_leadership_unique',         COALESCE((SELECT value FROM h WHERE metric_key='service_leadership_unique'), 0),
    'masterclass_total',                 COALESCE((SELECT value FROM h WHERE metric_key='masterclass_total'), 0),
    'masterclass_minus_servlead',        COALESCE((SELECT value FROM h WHERE metric_key='masterclass_minus_servlead'), 0),
    'historical_beginner_courses',       COALESCE((SELECT value FROM h WHERE metric_key='historical_beginner_courses'), 0),
    'historical_advanced_courses',       COALESCE((SELECT value FROM h WHERE metric_key='historical_advanced_courses'), 0),
    'last_synced_at',                    (SELECT max(last_synced_at) FROM h)
  )
);
$$;

GRANT EXECUTE ON FUNCTION public.get_network_stats() TO anon, authenticated, service_role;

SELECT public.recompute_all_stats();