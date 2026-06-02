-- Refactor KPI Dashboard — schema, seed, snapshot RPC, read RPC, cron

CREATE TABLE IF NOT EXISTS public.refactor_kpi_catalog (
  metric_key      TEXT PRIMARY KEY,
  label           TEXT NOT NULL,
  description     TEXT NOT NULL,
  unit            TEXT NOT NULL CHECK (unit IN ('percent','count','minutes','ratio','seconds')),
  baseline_value  NUMERIC NOT NULL,
  target_value    NUMERIC NOT NULL,
  direction       TEXT NOT NULL CHECK (direction IN ('lower_is_better','higher_is_better')),
  category        TEXT NOT NULL CHECK (category IN ('errors','ux','email','infra','auth')),
  related_section TEXT NOT NULL,
  sort_order      INT NOT NULL DEFAULT 100,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.refactor_kpi_catalog TO authenticated;
GRANT ALL    ON public.refactor_kpi_catalog TO service_role;
ALTER TABLE  public.refactor_kpi_catalog ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admins read refactor_kpi_catalog" ON public.refactor_kpi_catalog;
CREATE POLICY "admins read refactor_kpi_catalog"
  ON public.refactor_kpi_catalog FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TABLE IF NOT EXISTS public.refactor_kpi_daily (
  id            BIGSERIAL PRIMARY KEY,
  snapshot_date DATE NOT NULL,
  metric_key    TEXT NOT NULL REFERENCES public.refactor_kpi_catalog(metric_key) ON DELETE CASCADE,
  metric_value  NUMERIC NOT NULL,
  metric_unit   TEXT NOT NULL,
  numerator     BIGINT,
  denominator   BIGINT,
  window_label  TEXT NOT NULL CHECK (window_label IN ('last_24h','last_7d','last_30d')),
  computed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT refactor_kpi_daily_unique UNIQUE (snapshot_date, metric_key, window_label)
);
CREATE INDEX IF NOT EXISTS refactor_kpi_daily_key_date_idx
  ON public.refactor_kpi_daily (metric_key, snapshot_date DESC);
GRANT SELECT ON public.refactor_kpi_daily TO authenticated;
GRANT ALL    ON public.refactor_kpi_daily TO service_role;
ALTER TABLE  public.refactor_kpi_daily ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admins read refactor_kpi_daily" ON public.refactor_kpi_daily;
CREATE POLICY "admins read refactor_kpi_daily"
  ON public.refactor_kpi_daily FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

INSERT INTO public.refactor_kpi_catalog
  (metric_key, label, description, unit, baseline_value, target_value, direction, category, related_section, sort_order)
VALUES
  ('audit_log_error_pct',              'Audit-log error rate',          'Share of audit-log rows tagged as errors. Lower is better.',                                           'percent', 7.9,    1.5,  'lower_is_better',  'errors', 'Part 1 §1.1, §1.6', 10),
  ('object_object_log_rows',           'Unreadable error log rows',     'Number of error rows logged as "[object Object]" (cannot be debugged).',                                'count',   614,    0,    'lower_is_better',  'errors', 'Part 1 §1.6',       20),
  ('serviceworker_noise_rows',         'Service worker noise',          'Background service-worker error rows that flood the log without being real errors.',                   'count',   387,    0,    'lower_is_better',  'errors', 'Part 1 §1.6',       30),
  ('chunk_load_brick_sessions',        'Chunk-load brick sessions',     'Sessions where a code chunk failed to load and the app could not recover.',                            'count',   36,     0,    'lower_is_better',  'errors', 'Part 1 §1.5',       40),
  ('useauth_provider_misses',          'Auth provider misses',          'White-screen errors caused by useAuth() being called outside the provider.',                           'count',   20,     0,    'lower_is_better',  'errors', 'Part 1 §1.5',       50),
  ('profile_updates_30d',              'Profile saves (30 days)',       'Total profile-save events in the last 30 days. We expect a 70% drop after explicit Save.',             'count',   21800,  6500, 'lower_is_better',  'ux',     'Part 2 §A1',        110),
  ('profile_edits_per_user_p95',       'Profile edits per user (p95)',  '95th-percentile profile-edit count per member. High means people keep coming back to fix things.',     'count',   27,     3,    'lower_is_better',  'ux',     'Part 2 §A1',        120),
  ('profile_edits_within_5min',        'Profile thrash after signup',   'Profile updates within 5 minutes of profile creation — a sign onboarding is unclear.',                  'count',   2015,   300,  'lower_is_better',  'ux',     'Part 2 §A2',        130),
  ('task_uncompletion_pct',            'Task uncompletion rate',        'Share of task completions that get reversed. Should be near zero.',                                    'percent', 2.82,   0.3,  'lower_is_better',  'ux',     'Part 2 §B1',        140),
  ('general_app_submit_rate',          'General application submit rate','Share of started general applications that get submitted.',                                            'percent', 56.9,   80,   'higher_is_better', 'ux',     'Part 2 §G1',        150),
  ('discord_attempts_per_success',     'Discord linking attempts',      'Average username-lookup attempts before a Discord account is successfully linked.',                    'ratio',   2.35,   1.1,  'lower_is_better',  'ux',     'Part 2 §D1',        160),
  ('announcement_reread_count',        'Announcement re-reads',         'Number of times the same member reopens the same announcement.',                                       'count',   420,    50,   'lower_is_better',  'ux',     'Part 2 §C1',        170),
  ('avatar_reupload_max_per_user',     'Avatar re-uploads (max)',       'Most times a single member has re-uploaded their avatar — high means the cropper is missing.',         'count',   70,     3,    'lower_is_better',  'ux',     'Part 2 §J1',        180),
  ('time_to_first_task_avg_minutes',   'Time to first task (avg)',      'Average minutes from signup to completing the first task. Lower means onboarding is clearer.',         'minutes', 567,    10,   'lower_is_better',  'ux',     'Part 2 §B2',        190),
  ('email_dlq_replay_latency_p95_seconds', 'Email replay latency (p95)','How long failed emails wait before being retried. Lower is better.',                                    'seconds', 86400,  300,  'lower_is_better',  'email', 'Part 1 §1.3',       210),
  ('email_frequency_capped_count',     'Emails silently capped',        'Bulk emails rejected by the frequency cap without telling the member.',                                'count',   57,     0,    'lower_is_better',  'email', 'Part 1 §1.3',       220),
  ('email_rate_limited_count',         'Emails rate-limited',           'Emails that hit the provider rate limit and had to wait.',                                             'count',   29,     0,    'lower_is_better',  'email', 'Part 1 §1.3',       230),
  ('email_failed_count',               'Emails failed outright',        'Emails that never made it to the provider.',                                                           'count',   39,     0,    'lower_is_better',  'email', 'Part 1 §1.3',       240),
  ('notification_fanout_duplicates',   'Duplicate notifications',       'Duplicate notification rows the system tried to write (blocked by dedupe).',                            'count',   1015,   0,    'lower_is_better',  'infra', 'Part 1 §1.2',       310),
  ('admin_notification_peak_per_user_per_week', 'Admin notification peak','Most notifications a single admin received in one week. High means we are noisy.',                    'count',   283,    30,   'lower_is_better',  'infra', 'Part 2 §F1',        320),
  ('rapid_repeat_writes',              'Rapid repeat writes',           'Same write submitted twice within 1 second — indicates missing idempotency.',                          'count',   773,    0,    'lower_is_better',  'infra', 'Part 1 §1.2',       330),
  ('freescout_transport_errors',       'Get Help transport errors',     'Help-desk requests that failed at the network layer.',                                                 'count',   12,     0,    'lower_is_better',  'infra', 'Part 1 §1.7',       340),
  ('signup_post_captcha_completion_pct','Signup completion after captcha','Share of people who finish signup after the captcha is ready. Higher is better.',                     'percent', 63,     95,   'higher_is_better', 'auth',  'Part 2 §E1',        410),
  ('captcha_silent_block_count',       'Silent captcha blocks',         'Signups blocked by an unloaded captcha widget without any visible error.',                             'count',   25,     0,    'lower_is_better',  'auth',  'Part 2 §E1',        420),
  ('login_retry_pct',                  'Login retry rate',              'Share of logins that required at least one retry.',                                                    'percent', 10,     2,    'lower_is_better',  'auth',  'Part 2 §E2',        430)
ON CONFLICT (metric_key) DO UPDATE SET
  label = EXCLUDED.label, description = EXCLUDED.description, unit = EXCLUDED.unit,
  baseline_value = EXCLUDED.baseline_value, target_value = EXCLUDED.target_value,
  direction = EXCLUDED.direction, category = EXCLUDED.category,
  related_section = EXCLUDED.related_section, sort_order = EXCLUDED.sort_order;

-- Helper: upsert a single snapshot value safely (NULL-safe)
CREATE OR REPLACE FUNCTION public._upsert_kpi(
  p_date DATE, p_key TEXT, p_value NUMERIC, p_unit TEXT, p_window TEXT,
  p_num BIGINT DEFAULT NULL, p_den BIGINT DEFAULT NULL
) RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.refactor_kpi_daily(snapshot_date, metric_key, metric_value, metric_unit, numerator, denominator, window_label)
  VALUES (p_date, p_key, COALESCE(p_value, 0), p_unit, p_num, p_den, p_window)
  ON CONFLICT (snapshot_date, metric_key, window_label) DO UPDATE SET
    metric_value = COALESCE(EXCLUDED.metric_value, 0),
    numerator = EXCLUDED.numerator,
    denominator = EXCLUDED.denominator,
    computed_at = now();
$$;
REVOKE ALL ON FUNCTION public._upsert_kpi(DATE,TEXT,NUMERIC,TEXT,TEXT,BIGINT,BIGINT) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.snapshot_refactor_kpis()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today DATE := (now() AT TIME ZONE 'UTC')::date;
  w RECORD;
  v_from TIMESTAMPTZ;
  v_num NUMERIC; v_den NUMERIC; v_val NUMERIC;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin'::app_role)
          OR auth.role() = 'service_role') THEN
    RAISE EXCEPTION 'snapshot_refactor_kpis: admin or service role required';
  END IF;

  FOR w IN
    SELECT 'last_24h'::text AS label, (now() - interval '24 hours')::timestamptz AS since
    UNION ALL SELECT 'last_7d', (now() - interval '7 days')
  LOOP
    v_from := w.since;

    -- audit_log_error_pct
    SELECT SUM(CASE WHEN event_type IN ('client_error','ui_render_error','email_failed','ui_chunk_load_failed') THEN 1 ELSE 0 END),
           COUNT(*)
      INTO v_num, v_den FROM audit_log WHERE created_at >= v_from;
    PERFORM public._upsert_kpi(v_today, 'audit_log_error_pct',
      ROUND(100.0 * COALESCE(v_num,0) / NULLIF(v_den,0), 2), 'percent', w.label, v_num::BIGINT, v_den::BIGINT);

    -- object_object_log_rows
    SELECT COUNT(*) INTO v_val FROM audit_log WHERE created_at >= v_from AND error_message ILIKE '%[object Object]%';
    PERFORM public._upsert_kpi(v_today, 'object_object_log_rows', v_val, 'count', w.label);

    -- serviceworker_noise_rows
    SELECT COUNT(*) INTO v_val FROM audit_log WHERE created_at >= v_from
      AND (error_message ILIKE '%serviceworker%' OR error_message ILIKE '%sw.js%' OR 'source:sw' = ANY(COALESCE(changed_fields,'{}')));
    PERFORM public._upsert_kpi(v_today, 'serviceworker_noise_rows', v_val, 'count', w.label);

    -- chunk_load_brick_sessions
    SELECT COUNT(*) INTO v_val FROM audit_log WHERE created_at >= v_from AND event_type = 'ui_chunk_load_failed';
    PERFORM public._upsert_kpi(v_today, 'chunk_load_brick_sessions', v_val, 'count', w.label);

    -- useauth_provider_misses
    SELECT COUNT(*) INTO v_val FROM audit_log WHERE created_at >= v_from
      AND (error_message ILIKE '%useAuth must be used within%' OR error_message ILIKE '%AuthProvider%');
    PERFORM public._upsert_kpi(v_today, 'useauth_provider_misses', v_val, 'count', w.label);

    -- profile_updates_30d
    SELECT COUNT(*) INTO v_val FROM audit_log WHERE created_at >= v_from AND event_type IN ('profile_updated','profiles_update');
    PERFORM public._upsert_kpi(v_today, 'profile_updates_30d', v_val, 'count', w.label);

    -- profile_edits_per_user_p95
    SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY cnt) INTO v_val FROM (
      SELECT user_id, COUNT(*) AS cnt FROM audit_log
      WHERE created_at >= v_from AND event_type IN ('profile_updated','profiles_update') AND user_id IS NOT NULL
      GROUP BY user_id
    ) t;
    PERFORM public._upsert_kpi(v_today, 'profile_edits_per_user_p95', v_val, 'count', w.label);

    -- profile_edits_within_5min
    SELECT COUNT(*) INTO v_val FROM audit_log u
    WHERE u.created_at >= v_from AND u.event_type IN ('profile_updated','profiles_update') AND EXISTS (
      SELECT 1 FROM audit_log c WHERE c.event_type = 'profile_created' AND c.user_id = u.user_id
        AND u.created_at BETWEEN c.created_at AND c.created_at + interval '5 minutes'
    );
    PERFORM public._upsert_kpi(v_today, 'profile_edits_within_5min', v_val, 'count', w.label);

    -- task_uncompletion_pct
    SELECT SUM(CASE WHEN event_type = 'task_uncompleted' THEN 1 ELSE 0 END),
           SUM(CASE WHEN event_type IN ('task_completed','task_uncompleted') THEN 1 ELSE 0 END)
      INTO v_num, v_den FROM audit_log WHERE created_at >= v_from AND event_type IN ('task_completed','task_uncompleted');
    PERFORM public._upsert_kpi(v_today, 'task_uncompletion_pct',
      ROUND(100.0 * COALESCE(v_num,0) / NULLIF(v_den,0), 2), 'percent', w.label, v_num::BIGINT, v_den::BIGINT);

    -- general_app_submit_rate
    SELECT SUM(CASE WHEN event_type = 'application_submitted' THEN 1 ELSE 0 END),
           SUM(CASE WHEN event_type IN ('application_created','application_submitted') THEN 1 ELSE 0 END)
      INTO v_num, v_den FROM audit_log WHERE created_at >= v_from AND event_type IN ('application_created','application_submitted');
    PERFORM public._upsert_kpi(v_today, 'general_app_submit_rate',
      ROUND(100.0 * COALESCE(v_num,0) / NULLIF(v_den,0), 2), 'percent', w.label, v_num::BIGINT, v_den::BIGINT);

    -- discord_attempts_per_success
    SELECT SUM(CASE WHEN event_type IN ('discord_username_candidates_returned','discord_username_not_found') THEN 1 ELSE 0 END),
           SUM(CASE WHEN event_type = 'discord_link_succeeded' THEN 1 ELSE 0 END)
      INTO v_num, v_den FROM audit_log WHERE created_at >= v_from
      AND event_type IN ('discord_username_candidates_returned','discord_username_not_found','discord_link_succeeded');
    PERFORM public._upsert_kpi(v_today, 'discord_attempts_per_success',
      ROUND(COALESCE(v_num,0) / NULLIF(v_den,0), 2), 'ratio', w.label, v_num::BIGINT, v_den::BIGINT);

    -- announcement_reread_count
    SELECT GREATEST(COUNT(*) - COUNT(DISTINCT (user_id::text || ':' || COALESCE(record_id,''))), 0) INTO v_val
      FROM audit_log WHERE created_at >= v_from AND event_type = 'announcement_read';
    PERFORM public._upsert_kpi(v_today, 'announcement_reread_count', v_val, 'count', w.label);

    -- avatar_reupload_max_per_user
    SELECT MAX(cnt) INTO v_val FROM (
      SELECT user_id, COUNT(*) AS cnt FROM audit_log
      WHERE created_at >= v_from AND event_type IN ('avatar_uploaded','profile_avatar_updated') AND user_id IS NOT NULL
      GROUP BY user_id
    ) t;
    PERFORM public._upsert_kpi(v_today, 'avatar_reupload_max_per_user', v_val, 'count', w.label);

    -- time_to_first_task_avg_minutes
    SELECT ROUND(AVG(EXTRACT(EPOCH FROM (first_task - signup)) / 60.0)::numeric, 1) INTO v_val FROM (
      SELECT p.user_id, MIN(p.created_at) AS signup,
             (SELECT MIN(a.created_at) FROM audit_log a WHERE a.user_id = p.user_id AND a.event_type = 'task_completed') AS first_task
      FROM audit_log p
      WHERE p.event_type = 'profile_created' AND p.created_at >= v_from AND p.user_id IS NOT NULL
      GROUP BY p.user_id
    ) t WHERE first_task IS NOT NULL;
    PERFORM public._upsert_kpi(v_today, 'time_to_first_task_avg_minutes', v_val, 'minutes', w.label);

    -- email_dlq_replay_latency_p95_seconds (best-effort placeholder until DLQ table is wired)
    PERFORM public._upsert_kpi(v_today, 'email_dlq_replay_latency_p95_seconds', 0, 'seconds', w.label);

    -- email_frequency_capped_count
    SELECT COUNT(*) INTO v_val FROM audit_log WHERE created_at >= v_from AND event_type = 'email_frequency_capped';
    PERFORM public._upsert_kpi(v_today, 'email_frequency_capped_count', v_val, 'count', w.label);

    -- email_rate_limited_count
    SELECT COUNT(*) INTO v_val FROM audit_log WHERE created_at >= v_from AND event_type = 'email_rate_limited';
    PERFORM public._upsert_kpi(v_today, 'email_rate_limited_count', v_val, 'count', w.label);

    -- email_failed_count
    SELECT COUNT(*) INTO v_val FROM audit_log WHERE created_at >= v_from AND event_type = 'email_failed';
    PERFORM public._upsert_kpi(v_today, 'email_failed_count', v_val, 'count', w.label);

    -- notification_fanout_duplicates
    SELECT COUNT(*) INTO v_val FROM audit_log WHERE created_at >= v_from AND event_type IN ('notification_dedupe_blocked','notification_duplicate');
    PERFORM public._upsert_kpi(v_today, 'notification_fanout_duplicates', v_val, 'count', w.label);

    -- admin_notification_peak_per_user_per_week
    SELECT MAX(cnt) INTO v_val FROM (
      SELECT user_id, COUNT(*) AS cnt FROM audit_log
      WHERE created_at >= GREATEST(v_from, now() - interval '7 days')
        AND event_type IN ('notifications_insert','notification_created') AND user_id IS NOT NULL
      GROUP BY user_id
    ) t;
    PERFORM public._upsert_kpi(v_today, 'admin_notification_peak_per_user_per_week', v_val, 'count', w.label);

    -- rapid_repeat_writes
    SELECT COUNT(*) INTO v_val FROM (
      SELECT created_at, LAG(created_at) OVER (PARTITION BY user_id, event_type, record_id ORDER BY created_at) AS prev_at
      FROM audit_log WHERE created_at >= v_from AND user_id IS NOT NULL AND record_id IS NOT NULL
    ) t WHERE prev_at IS NOT NULL AND created_at - prev_at < interval '1 second';
    PERFORM public._upsert_kpi(v_today, 'rapid_repeat_writes', v_val, 'count', w.label);

    -- freescout_transport_errors
    SELECT COUNT(*) INTO v_val FROM audit_log WHERE created_at >= v_from
      AND (event_type ILIKE 'freescout_%' OR 'upstream:transport_error' = ANY(COALESCE(changed_fields,'{}')))
      AND (error_message IS NOT NULL OR event_type ILIKE '%error%' OR event_type ILIKE '%failed%');
    PERFORM public._upsert_kpi(v_today, 'freescout_transport_errors', v_val, 'count', w.label);

    -- signup_post_captcha_completion_pct
    SELECT SUM(CASE WHEN event_type = 'signup_succeeded' THEN 1 ELSE 0 END),
           SUM(CASE WHEN event_type IN ('signup_attempted','signup_succeeded') THEN 1 ELSE 0 END)
      INTO v_num, v_den FROM audit_log WHERE created_at >= v_from AND event_type IN ('signup_attempted','signup_succeeded');
    PERFORM public._upsert_kpi(v_today, 'signup_post_captcha_completion_pct',
      ROUND(100.0 * COALESCE(v_num,0) / NULLIF(v_den,0), 2), 'percent', w.label, v_num::BIGINT, v_den::BIGINT);

    -- captcha_silent_block_count
    SELECT COUNT(*) INTO v_val FROM audit_log WHERE created_at >= v_from
      AND (event_type IN ('captcha_silent_block','captcha_not_ready') OR error_message ILIKE '%captcha%not%ready%');
    PERFORM public._upsert_kpi(v_today, 'captcha_silent_block_count', v_val, 'count', w.label);

    -- login_retry_pct
    SELECT SUM(CASE WHEN event_type = 'login_retry' THEN 1 ELSE 0 END),
           SUM(CASE WHEN event_type IN ('login_attempted','login_succeeded','login_retry') THEN 1 ELSE 0 END)
      INTO v_num, v_den FROM audit_log WHERE created_at >= v_from AND event_type IN ('login_attempted','login_succeeded','login_retry');
    PERFORM public._upsert_kpi(v_today, 'login_retry_pct',
      ROUND(100.0 * COALESCE(v_num,0) / NULLIF(v_den,0), 2), 'percent', w.label, v_num::BIGINT, v_den::BIGINT);
  END LOOP;

  RETURN (SELECT COUNT(*)::INTEGER FROM public.refactor_kpi_daily WHERE snapshot_date = v_today);
END;
$$;
REVOKE ALL ON FUNCTION public.snapshot_refactor_kpis() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.snapshot_refactor_kpis() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_refactor_kpis(p_days INTEGER DEFAULT 30)
RETURNS TABLE (
  metric_key TEXT, label TEXT, description TEXT, category TEXT, unit TEXT,
  baseline_value NUMERIC, target_value NUMERIC, direction TEXT, related_section TEXT,
  current_value NUMERIC, previous_value NUMERIC, current_window TEXT,
  last_updated TIMESTAMPTZ, trend NUMERIC[], status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'get_refactor_kpis: admin only';
  END IF;

  RETURN QUERY
  WITH latest AS (
    SELECT DISTINCT ON (d.metric_key) d.metric_key, d.metric_value, d.window_label, d.computed_at
    FROM public.refactor_kpi_daily d WHERE d.window_label = 'last_24h'
    ORDER BY d.metric_key, d.snapshot_date DESC
  ),
  prev AS (
    SELECT DISTINCT ON (d.metric_key) d.metric_key, d.metric_value
    FROM public.refactor_kpi_daily d
    WHERE d.window_label = 'last_24h' AND d.snapshot_date < (now() AT TIME ZONE 'UTC')::date
    ORDER BY d.metric_key, d.snapshot_date DESC
  ),
  trend_data AS (
    SELECT d.metric_key, array_agg(d.metric_value ORDER BY d.snapshot_date) AS series
    FROM public.refactor_kpi_daily d
    WHERE d.window_label = 'last_24h'
      AND d.snapshot_date >= (now() AT TIME ZONE 'UTC')::date - (p_days || ' days')::interval
    GROUP BY d.metric_key
  )
  SELECT c.metric_key, c.label, c.description, c.category, c.unit,
         c.baseline_value, c.target_value, c.direction, c.related_section,
         l.metric_value, p.metric_value, l.window_label, l.computed_at,
         COALESCE(t.series, ARRAY[]::numeric[]),
         CASE
           WHEN l.metric_value IS NULL THEN 'no_data'
           WHEN c.direction = 'lower_is_better'  AND l.metric_value <= c.target_value THEN 'met'
           WHEN c.direction = 'higher_is_better' AND l.metric_value >= c.target_value THEN 'met'
           WHEN c.direction = 'lower_is_better'  AND l.metric_value >  c.baseline_value THEN 'off_track'
           WHEN c.direction = 'higher_is_better' AND l.metric_value <  c.baseline_value THEN 'off_track'
           WHEN c.direction = 'lower_is_better'  AND (c.baseline_value - l.metric_value) >= 0.5 * (c.baseline_value - c.target_value) THEN 'on_track'
           WHEN c.direction = 'higher_is_better' AND (l.metric_value - c.baseline_value) >= 0.5 * (c.target_value - c.baseline_value) THEN 'on_track'
           ELSE 'at_risk'
         END
  FROM public.refactor_kpi_catalog c
  LEFT JOIN latest     l ON l.metric_key = c.metric_key
  LEFT JOIN prev       p ON p.metric_key = c.metric_key
  LEFT JOIN trend_data t ON t.metric_key = c.metric_key
  ORDER BY c.category, c.sort_order, c.label;
END;
$$;
REVOKE ALL ON FUNCTION public.get_refactor_kpis(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_refactor_kpis(INTEGER) TO authenticated, service_role;

ALTER PUBLICATION supabase_realtime ADD TABLE public.refactor_kpi_daily;

DO $$
DECLARE v_jobid BIGINT;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'snapshot-refactor-kpis-daily';
  IF v_jobid IS NOT NULL THEN PERFORM cron.unschedule(v_jobid); END IF;
  PERFORM cron.schedule(
    'snapshot-refactor-kpis-daily',
    '30 2 * * *',
    $cron$ SELECT public.snapshot_refactor_kpis(); $cron$
  );
END;
$$;

SELECT public.snapshot_refactor_kpis();
