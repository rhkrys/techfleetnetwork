
DROP FUNCTION IF EXISTS public.snapshot_refactor_kpis();
DROP FUNCTION IF EXISTS public.get_refactor_kpis(INT);
DROP FUNCTION IF EXISTS public.run_refactor_kpis_snapshot_now();

CREATE OR REPLACE FUNCTION public.snapshot_refactor_kpis()
RETURNS TABLE(metric_key text, window_label text, metric_value numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_today DATE := CURRENT_DATE;
  v_24h_start TIMESTAMPTZ := now() - interval '24 hours';
  v_7d_start  TIMESTAMPTZ := now() - interval '7 days';
  v_30d_start TIMESTAMPTZ := now() - interval '30 days';
BEGIN
  INSERT INTO public.refactor_kpi_daily(snapshot_date, metric_key, metric_value, metric_unit, numerator, denominator, window_label, metadata)
  SELECT v_today, 'audit_log_error_pct',
    COALESCE(100.0 * SUM(CASE WHEN 'severity:error' = ANY(changed_fields) THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*),0), 0),
    'percent',
    SUM(CASE WHEN 'severity:error' = ANY(changed_fields) THEN 1 ELSE 0 END),
    COUNT(*),
    w.label,
    jsonb_build_object('window', w.label)
  FROM public.audit_log a
  CROSS JOIN (VALUES ('last_24h', v_24h_start), ('last_7d', v_7d_start)) AS w(label, since)
  WHERE a.created_at >= w.since
  GROUP BY w.label
  ON CONFLICT (snapshot_date, metric_key, window_label) DO UPDATE
    SET metric_value = EXCLUDED.metric_value, numerator = EXCLUDED.numerator,
        denominator = EXCLUDED.denominator, computed_at = now(), metadata = EXCLUDED.metadata;

  INSERT INTO public.refactor_kpi_daily(snapshot_date, metric_key, metric_value, metric_unit, numerator, window_label)
  SELECT v_today, 'object_object_log_rows',
    COALESCE(COUNT(*), 0), 'count', COUNT(*), w.label
  FROM public.audit_log a
  CROSS JOIN (VALUES ('last_24h', v_24h_start), ('last_7d', v_7d_start)) AS w(label, since)
  WHERE a.created_at >= w.since
    AND (a.changed_fields::text ILIKE '%[object Object]%' OR a.event_type ILIKE '%[object Object]%')
  GROUP BY w.label
  ON CONFLICT (snapshot_date, metric_key, window_label) DO UPDATE
    SET metric_value = EXCLUDED.metric_value, numerator = EXCLUDED.numerator, computed_at = now();

  INSERT INTO public.refactor_kpi_daily(snapshot_date, metric_key, metric_value, metric_unit, numerator, window_label)
  SELECT v_today, 'serviceworker_noise_rows',
    COALESCE(COUNT(*), 0), 'count', COUNT(*), w.label
  FROM public.audit_log a
  CROSS JOIN (VALUES ('last_24h', v_24h_start), ('last_7d', v_7d_start)) AS w(label, since)
  WHERE a.created_at >= w.since
    AND (a.changed_fields::text ILIKE '%serviceworker%' OR a.changed_fields::text ILIKE '%service-worker%' OR a.event_type ILIKE '%sw_%')
  GROUP BY w.label
  ON CONFLICT (snapshot_date, metric_key, window_label) DO UPDATE
    SET metric_value = EXCLUDED.metric_value, numerator = EXCLUDED.numerator, computed_at = now();

  INSERT INTO public.refactor_kpi_daily(snapshot_date, metric_key, metric_value, metric_unit, numerator, window_label)
  SELECT v_today, 'chunk_load_brick_sessions',
    COALESCE(COUNT(DISTINCT (a.changed_fields->>'session_id')), 0), 'count',
    COUNT(DISTINCT (a.changed_fields->>'session_id')), w.label
  FROM public.audit_log a
  CROSS JOIN (VALUES ('last_24h', v_24h_start), ('last_7d', v_7d_start)) AS w(label, since)
  WHERE a.created_at >= w.since
    AND (a.event_type ILIKE '%chunk_load%' OR a.changed_fields::text ILIKE '%ChunkLoadError%')
  GROUP BY w.label
  ON CONFLICT (snapshot_date, metric_key, window_label) DO UPDATE
    SET metric_value = EXCLUDED.metric_value, numerator = EXCLUDED.numerator, computed_at = now();

  INSERT INTO public.refactor_kpi_daily(snapshot_date, metric_key, metric_value, metric_unit, numerator, window_label)
  SELECT v_today, 'useauth_provider_misses',
    COALESCE(COUNT(*), 0), 'count', COUNT(*), w.label
  FROM public.audit_log a
  CROSS JOIN (VALUES ('last_24h', v_24h_start), ('last_7d', v_7d_start)) AS w(label, since)
  WHERE a.created_at >= w.since
    AND a.changed_fields::text ILIKE '%useAuth must be used within%'
  GROUP BY w.label
  ON CONFLICT (snapshot_date, metric_key, window_label) DO UPDATE
    SET metric_value = EXCLUDED.metric_value, numerator = EXCLUDED.numerator, computed_at = now();

  INSERT INTO public.refactor_kpi_daily(snapshot_date, metric_key, metric_value, metric_unit, numerator, window_label, metadata)
  SELECT v_today, 'profile_updates_30d',
    COALESCE(COUNT(*), 0), 'count', COUNT(*), 'last_30d',
    jsonb_build_object('window_days', 30)
  FROM public.audit_log
  WHERE created_at >= v_30d_start AND event_type = 'profile_updated'
  ON CONFLICT (snapshot_date, metric_key, window_label) DO UPDATE
    SET metric_value = EXCLUDED.metric_value, numerator = EXCLUDED.numerator, computed_at = now();

  INSERT INTO public.refactor_kpi_daily(snapshot_date, metric_key, metric_value, metric_unit, window_label)
  SELECT v_today, 'profile_edits_per_user_p95',
    COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY cnt), 0), 'count', 'last_30d'
  FROM (
    SELECT actor_id, COUNT(*) AS cnt
    FROM public.audit_log
    WHERE created_at >= v_30d_start AND event_type = 'profile_updated' AND actor_id IS NOT NULL
    GROUP BY actor_id
  ) per_user
  ON CONFLICT (snapshot_date, metric_key, window_label) DO UPDATE
    SET metric_value = EXCLUDED.metric_value, computed_at = now();

  INSERT INTO public.refactor_kpi_daily(snapshot_date, metric_key, metric_value, metric_unit, numerator, window_label)
  SELECT v_today, 'profile_edits_within_5min',
    COALESCE(COUNT(*), 0), 'count', COUNT(*), 'last_30d'
  FROM public.audit_log u
  WHERE u.created_at >= v_30d_start AND u.event_type = 'profile_updated'
    AND EXISTS (
      SELECT 1 FROM public.audit_log c
      WHERE c.event_type = 'profile_created' AND c.actor_id = u.actor_id
        AND u.created_at - c.created_at BETWEEN interval '0' AND interval '5 minutes'
    )
  ON CONFLICT (snapshot_date, metric_key, window_label) DO UPDATE
    SET metric_value = EXCLUDED.metric_value, numerator = EXCLUDED.numerator, computed_at = now();

  INSERT INTO public.refactor_kpi_daily(snapshot_date, metric_key, metric_value, metric_unit, numerator, denominator, window_label)
  SELECT v_today, 'task_uncompletion_pct',
    COALESCE(100.0 * SUM(CASE WHEN event_type = 'task_uncompleted' THEN 1 ELSE 0 END)::numeric
      / NULLIF(SUM(CASE WHEN event_type IN ('task_completed','task_uncompleted') THEN 1 ELSE 0 END), 0), 0),
    'percent',
    SUM(CASE WHEN event_type = 'task_uncompleted' THEN 1 ELSE 0 END),
    SUM(CASE WHEN event_type IN ('task_completed','task_uncompleted') THEN 1 ELSE 0 END),
    'last_7d'
  FROM public.audit_log WHERE created_at >= v_7d_start
  ON CONFLICT (snapshot_date, metric_key, window_label) DO UPDATE
    SET metric_value = EXCLUDED.metric_value, numerator = EXCLUDED.numerator,
        denominator = EXCLUDED.denominator, computed_at = now();

  INSERT INTO public.refactor_kpi_daily(snapshot_date, metric_key, metric_value, metric_unit, numerator, denominator, window_label)
  SELECT v_today, 'general_app_submit_rate',
    COALESCE(100.0 * SUM(CASE WHEN submitted_at IS NOT NULL THEN 1 ELSE 0 END)::numeric
      / NULLIF(COUNT(*), 0), 0),
    'percent',
    SUM(CASE WHEN submitted_at IS NOT NULL THEN 1 ELSE 0 END),
    COUNT(*),
    'last_30d'
  FROM public.general_applications WHERE created_at >= v_30d_start
  ON CONFLICT (snapshot_date, metric_key, window_label) DO UPDATE
    SET metric_value = EXCLUDED.metric_value, numerator = EXCLUDED.numerator,
        denominator = EXCLUDED.denominator, computed_at = now();

  INSERT INTO public.refactor_kpi_daily(snapshot_date, metric_key, metric_value, metric_unit, numerator, denominator, window_label)
  SELECT v_today, 'discord_attempts_per_success',
    COALESCE(SUM(CASE WHEN event_type IN ('discord_lookup','discord_link_attempt') THEN 1 ELSE 0 END)::numeric
      / NULLIF(SUM(CASE WHEN event_type = 'discord_link_success' THEN 1 ELSE 0 END), 0), 0),
    'ratio',
    SUM(CASE WHEN event_type IN ('discord_lookup','discord_link_attempt') THEN 1 ELSE 0 END),
    SUM(CASE WHEN event_type = 'discord_link_success' THEN 1 ELSE 0 END),
    'last_30d'
  FROM public.audit_log WHERE created_at >= v_30d_start
  ON CONFLICT (snapshot_date, metric_key, window_label) DO UPDATE
    SET metric_value = EXCLUDED.metric_value, numerator = EXCLUDED.numerator,
        denominator = EXCLUDED.denominator, computed_at = now();

  INSERT INTO public.refactor_kpi_daily(snapshot_date, metric_key, metric_value, metric_unit, window_label)
  SELECT v_today, 'announcement_reread_count',
    COALESCE(MAX(cnt), 0), 'count', 'last_7d'
  FROM (
    SELECT actor_id, (changed_fields->>'announcement_id') AS aid, COUNT(*) AS cnt
    FROM public.audit_log
    WHERE created_at >= v_7d_start AND event_type = 'announcement_read' AND actor_id IS NOT NULL
    GROUP BY actor_id, (changed_fields->>'announcement_id')
  ) re
  ON CONFLICT (snapshot_date, metric_key, window_label) DO UPDATE
    SET metric_value = EXCLUDED.metric_value, computed_at = now();

  INSERT INTO public.refactor_kpi_daily(snapshot_date, metric_key, metric_value, metric_unit, window_label)
  SELECT v_today, 'avatar_reupload_max_per_user',
    COALESCE(MAX(cnt), 0), 'count', 'last_30d'
  FROM (
    SELECT actor_id, COUNT(*) AS cnt
    FROM public.audit_log
    WHERE created_at >= v_30d_start AND event_type IN ('avatar_uploaded','avatar_updated')
    GROUP BY actor_id
  ) p
  ON CONFLICT (snapshot_date, metric_key, window_label) DO UPDATE
    SET metric_value = EXCLUDED.metric_value, computed_at = now();

  INSERT INTO public.refactor_kpi_daily(snapshot_date, metric_key, metric_value, metric_unit, window_label)
  SELECT v_today, 'time_to_first_task_avg_minutes',
    COALESCE(AVG(EXTRACT(EPOCH FROM (jp.completed_at - p.created_at)) / 60.0), 0),
    'minutes', 'last_30d'
  FROM public.profiles p
  JOIN LATERAL (
    SELECT MIN(completed_at) AS completed_at
    FROM public.journey_progress
    WHERE user_id = p.user_id AND completed = true
  ) jp ON jp.completed_at IS NOT NULL
  WHERE p.created_at >= v_30d_start
  ON CONFLICT (snapshot_date, metric_key, window_label) DO UPDATE
    SET metric_value = EXCLUDED.metric_value, computed_at = now();

  INSERT INTO public.refactor_kpi_daily(snapshot_date, metric_key, metric_value, metric_unit, window_label)
  SELECT v_today, 'email_dlq_replay_latency_p95_seconds',
    COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY delta_seconds), 0),
    'count', 'last_7d'
  FROM (
    SELECT EXTRACT(EPOCH FROM (sent.created_at - fail.created_at)) AS delta_seconds
    FROM public.email_send_log fail
    JOIN public.email_send_log sent
      ON sent.message_id = fail.message_id AND sent.status = 'sent'
    WHERE fail.created_at >= v_7d_start
      AND fail.status IN ('failed','dlq')
      AND sent.created_at > fail.created_at
  ) d
  ON CONFLICT (snapshot_date, metric_key, window_label) DO UPDATE
    SET metric_value = EXCLUDED.metric_value, computed_at = now();

  INSERT INTO public.refactor_kpi_daily(snapshot_date, metric_key, metric_value, metric_unit, numerator, window_label)
  SELECT v_today, 'email_frequency_capped_count',
    COALESCE(COUNT(*), 0), 'count', COUNT(*), 'last_7d'
  FROM public.email_send_log
  WHERE created_at >= v_7d_start AND status = 'frequency_capped'
  ON CONFLICT (snapshot_date, metric_key, window_label) DO UPDATE
    SET metric_value = EXCLUDED.metric_value, numerator = EXCLUDED.numerator, computed_at = now();

  INSERT INTO public.refactor_kpi_daily(snapshot_date, metric_key, metric_value, metric_unit, numerator, window_label)
  SELECT v_today, 'email_rate_limited_count',
    COALESCE(COUNT(*), 0), 'count', COUNT(*), 'last_7d'
  FROM public.email_send_log
  WHERE created_at >= v_7d_start
    AND (status ILIKE '%rate%' OR error_message ILIKE '%429%' OR error_message ILIKE '%rate limit%')
  ON CONFLICT (snapshot_date, metric_key, window_label) DO UPDATE
    SET metric_value = EXCLUDED.metric_value, numerator = EXCLUDED.numerator, computed_at = now();

  INSERT INTO public.refactor_kpi_daily(snapshot_date, metric_key, metric_value, metric_unit, numerator, window_label)
  SELECT v_today, 'email_failed_count',
    COALESCE(COUNT(*), 0), 'count', COUNT(*), 'last_7d'
  FROM public.email_send_log
  WHERE created_at >= v_7d_start AND status IN ('failed','dlq','bounced')
  ON CONFLICT (snapshot_date, metric_key, window_label) DO UPDATE
    SET metric_value = EXCLUDED.metric_value, numerator = EXCLUDED.numerator, computed_at = now();

  INSERT INTO public.refactor_kpi_daily(snapshot_date, metric_key, metric_value, metric_unit, numerator, window_label)
  SELECT v_today, 'notification_fanout_duplicates',
    COALESCE(SUM(GREATEST(cnt - 1, 0)), 0), 'count', SUM(GREATEST(cnt - 1, 0)), 'last_7d'
  FROM (
    SELECT user_id, type, COALESCE(reference_id::text, '') AS ref, COUNT(*) AS cnt
    FROM public.notifications
    WHERE created_at >= v_7d_start
    GROUP BY user_id, type, COALESCE(reference_id::text, '')
  ) d
  ON CONFLICT (snapshot_date, metric_key, window_label) DO UPDATE
    SET metric_value = EXCLUDED.metric_value, numerator = EXCLUDED.numerator, computed_at = now();

  INSERT INTO public.refactor_kpi_daily(snapshot_date, metric_key, metric_value, metric_unit, window_label)
  SELECT v_today, 'admin_notification_peak_per_user_per_week',
    COALESCE(MAX(cnt), 0), 'count', 'last_7d'
  FROM (
    SELECT user_id, COUNT(*) AS cnt
    FROM public.notifications
    WHERE created_at >= v_7d_start
    GROUP BY user_id
  ) p
  ON CONFLICT (snapshot_date, metric_key, window_label) DO UPDATE
    SET metric_value = EXCLUDED.metric_value, computed_at = now();

  INSERT INTO public.refactor_kpi_daily(snapshot_date, metric_key, metric_value, metric_unit, numerator, window_label)
  SELECT v_today, 'rapid_repeat_writes',
    COALESCE(COUNT(*), 0), 'count', COUNT(*), w.label
  FROM (
    SELECT actor_id, event_type, created_at,
      LAG(created_at) OVER (PARTITION BY actor_id, event_type ORDER BY created_at) AS prev
    FROM public.audit_log
    WHERE created_at >= v_7d_start AND actor_id IS NOT NULL
  ) x
  CROSS JOIN (VALUES ('last_24h', v_24h_start), ('last_7d', v_7d_start)) AS w(label, since)
  WHERE x.created_at >= w.since AND x.prev IS NOT NULL AND x.created_at - x.prev < interval '2 seconds'
  GROUP BY w.label
  ON CONFLICT (snapshot_date, metric_key, window_label) DO UPDATE
    SET metric_value = EXCLUDED.metric_value, numerator = EXCLUDED.numerator, computed_at = now();

  INSERT INTO public.refactor_kpi_daily(snapshot_date, metric_key, metric_value, metric_unit, numerator, window_label)
  SELECT v_today, 'freescout_transport_errors',
    COALESCE(COUNT(*), 0), 'count', COUNT(*), 'last_7d'
  FROM public.audit_log
  WHERE created_at >= v_7d_start
    AND changed_fields::text ILIKE '%upstream:transport_error%'
  ON CONFLICT (snapshot_date, metric_key, window_label) DO UPDATE
    SET metric_value = EXCLUDED.metric_value, numerator = EXCLUDED.numerator, computed_at = now();

  INSERT INTO public.refactor_kpi_daily(snapshot_date, metric_key, metric_value, metric_unit, numerator, denominator, window_label)
  SELECT v_today, 'signup_post_captcha_completion_pct',
    COALESCE(100.0 * SUM(CASE WHEN event_type = 'signup_succeeded' THEN 1 ELSE 0 END)::numeric
      / NULLIF(SUM(CASE WHEN event_type = 'signup_captcha_ready' THEN 1 ELSE 0 END), 0), 0),
    'percent',
    SUM(CASE WHEN event_type = 'signup_succeeded' THEN 1 ELSE 0 END),
    SUM(CASE WHEN event_type = 'signup_captcha_ready' THEN 1 ELSE 0 END),
    'last_7d'
  FROM public.audit_log WHERE created_at >= v_7d_start
  ON CONFLICT (snapshot_date, metric_key, window_label) DO UPDATE
    SET metric_value = EXCLUDED.metric_value, numerator = EXCLUDED.numerator,
        denominator = EXCLUDED.denominator, computed_at = now();

  INSERT INTO public.refactor_kpi_daily(snapshot_date, metric_key, metric_value, metric_unit, numerator, window_label)
  SELECT v_today, 'captcha_silent_block_count',
    COALESCE(COUNT(*), 0), 'count', COUNT(*), 'last_7d'
  FROM public.audit_log
  WHERE created_at >= v_7d_start
    AND event_type IN ('signup_captcha_silent','signup_captcha_timeout')
  ON CONFLICT (snapshot_date, metric_key, window_label) DO UPDATE
    SET metric_value = EXCLUDED.metric_value, numerator = EXCLUDED.numerator, computed_at = now();

  INSERT INTO public.refactor_kpi_daily(snapshot_date, metric_key, metric_value, metric_unit, numerator, denominator, window_label)
  SELECT v_today, 'login_retry_pct',
    COALESCE(100.0 * SUM(CASE WHEN event_type = 'login_retry' THEN 1 ELSE 0 END)::numeric
      / NULLIF(SUM(CASE WHEN event_type IN ('login_attempt','login_retry') THEN 1 ELSE 0 END), 0), 0),
    'percent',
    SUM(CASE WHEN event_type = 'login_retry' THEN 1 ELSE 0 END),
    SUM(CASE WHEN event_type IN ('login_attempt','login_retry') THEN 1 ELSE 0 END),
    'last_7d'
  FROM public.audit_log WHERE created_at >= v_7d_start
  ON CONFLICT (snapshot_date, metric_key, window_label) DO UPDATE
    SET metric_value = EXCLUDED.metric_value, numerator = EXCLUDED.numerator,
        denominator = EXCLUDED.denominator, computed_at = now();

  RETURN QUERY
    SELECT d.metric_key, d.window_label, d.metric_value
    FROM public.refactor_kpi_daily d
    WHERE d.snapshot_date = v_today;
END;
$func$;

REVOKE ALL ON FUNCTION public.snapshot_refactor_kpis() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.snapshot_refactor_kpis() TO service_role;

CREATE OR REPLACE FUNCTION public.run_refactor_kpis_snapshot_now()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count INT;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'permission denied: admin role required';
  END IF;
  PERFORM public.snapshot_refactor_kpis();
  SELECT COUNT(*) INTO v_count FROM public.refactor_kpi_daily WHERE snapshot_date = CURRENT_DATE;
  RETURN jsonb_build_object('ok', true, 'rows', v_count, 'snapshot_date', CURRENT_DATE);
END;
$$;

REVOKE ALL ON FUNCTION public.run_refactor_kpis_snapshot_now() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.run_refactor_kpis_snapshot_now() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_refactor_kpis(p_days INT DEFAULT 30)
RETURNS TABLE (
  metric_key TEXT, label TEXT, description TEXT, category TEXT, unit TEXT,
  related_section TEXT, sort_order INT,
  baseline_value NUMERIC, target_value NUMERIC, direction TEXT,
  current_value NUMERIC, previous_value NUMERIC,
  trend NUMERIC[], last_snapshot TIMESTAMPTZ, status TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'permission denied: admin role required';
  END IF;

  RETURN QUERY
  WITH latest AS (
    SELECT DISTINCT ON (d.metric_key)
      d.metric_key, d.metric_value AS current_value, d.computed_at
    FROM public.refactor_kpi_daily d
    WHERE d.snapshot_date >= CURRENT_DATE - (p_days || ' days')::interval
    ORDER BY d.metric_key, d.snapshot_date DESC, d.computed_at DESC
  ),
  prev AS (
    SELECT DISTINCT ON (d.metric_key)
      d.metric_key, d.metric_value AS previous_value
    FROM public.refactor_kpi_daily d
    WHERE d.snapshot_date < CURRENT_DATE
      AND d.snapshot_date >= CURRENT_DATE - (p_days || ' days')::interval
    ORDER BY d.metric_key, d.snapshot_date DESC
  ),
  trend_agg AS (
    SELECT d.metric_key, ARRAY_AGG(d.metric_value ORDER BY d.snapshot_date) AS trend
    FROM (
      SELECT DISTINCT ON (metric_key, snapshot_date)
        metric_key, snapshot_date, metric_value, computed_at
      FROM public.refactor_kpi_daily
      WHERE snapshot_date >= CURRENT_DATE - (p_days || ' days')::interval
      ORDER BY metric_key, snapshot_date, computed_at DESC
    ) d
    GROUP BY d.metric_key
  )
  SELECT
    c.metric_key, c.label, c.description, c.category, c.unit,
    c.related_section, c.sort_order,
    c.baseline_value, c.target_value, c.direction,
    COALESCE(l.current_value, c.baseline_value),
    p.previous_value,
    COALESCE(t.trend, ARRAY[]::numeric[]),
    l.computed_at,
    CASE
      WHEN l.current_value IS NULL THEN 'no_data'
      WHEN c.direction = 'lower_is_better' AND l.current_value <= c.target_value THEN 'met'
      WHEN c.direction = 'higher_is_better' AND l.current_value >= c.target_value THEN 'met'
      WHEN c.direction = 'lower_is_better' AND l.current_value > c.baseline_value THEN 'off_track'
      WHEN c.direction = 'higher_is_better' AND l.current_value < c.baseline_value THEN 'off_track'
      WHEN c.direction = 'lower_is_better' AND c.baseline_value > c.target_value
        AND (c.baseline_value - l.current_value) / NULLIF(c.baseline_value - c.target_value, 0) >= 0.5 THEN 'on_track'
      WHEN c.direction = 'higher_is_better' AND c.target_value > c.baseline_value
        AND (l.current_value - c.baseline_value) / NULLIF(c.target_value - c.baseline_value, 0) >= 0.5 THEN 'on_track'
      ELSE 'at_risk'
    END
  FROM public.refactor_kpi_catalog c
  LEFT JOIN latest    l ON l.metric_key = c.metric_key
  LEFT JOIN prev      p ON p.metric_key = c.metric_key
  LEFT JOIN trend_agg t ON t.metric_key = c.metric_key
  ORDER BY c.category, c.sort_order, c.label;
END;
$$;

REVOKE ALL ON FUNCTION public.get_refactor_kpis(INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_refactor_kpis(INT) TO authenticated;

DO $$
BEGIN
  PERFORM cron.unschedule('snapshot-refactor-kpis-daily');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'snapshot-refactor-kpis-daily',
  '30 2 * * *',
  $$SELECT public.snapshot_refactor_kpis();$$
);
