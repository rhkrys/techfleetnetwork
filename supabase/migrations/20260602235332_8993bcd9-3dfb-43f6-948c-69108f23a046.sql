CREATE OR REPLACE FUNCTION public.snapshot_refactor_kpis()
RETURNS TABLE(metric_key TEXT, metric_value NUMERIC, window_label TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_today DATE := CURRENT_DATE;
  v_audit_total BIGINT; v_audit_err BIGINT;
  v_profile_updates BIGINT; v_p95 NUMERIC; v_within5 BIGINT;
  v_task_done BIGINT; v_task_undone BIGINT;
  v_app_started BIGINT; v_app_submitted BIGINT;
  v_obj_obj BIGINT; v_sw_noise BIGINT; v_chunk_brick BIGINT;
  v_provider_miss BIGINT; v_fs_errors BIGINT; v_bulk_rej BIGINT;
  v_country_edits BIGINT;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR auth.role() = 'service_role') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT count(*), count(*) FILTER (
    WHERE changed_fields IS NOT NULL AND 'severity:error' = ANY(changed_fields)
  ) INTO v_audit_total, v_audit_err
  FROM public.audit_log WHERE created_at >= now() - INTERVAL '7 days';
  INSERT INTO public.refactor_kpi_daily (snapshot_date, metric_key, metric_value, metric_unit, numerator, denominator, window_label)
  VALUES (v_today, 'audit_log_error_pct',
     CASE WHEN v_audit_total > 0 THEN ROUND(100.0 * v_audit_err / v_audit_total, 2) ELSE 0 END,
     'percent', v_audit_err, v_audit_total, 'last_7d')
  ON CONFLICT (snapshot_date, metric_key, window_label) DO UPDATE
    SET metric_value = EXCLUDED.metric_value, numerator = EXCLUDED.numerator,
        denominator = EXCLUDED.denominator, computed_at = now();

  SELECT count(*) INTO v_profile_updates FROM public.audit_log
  WHERE created_at >= now() - INTERVAL '30 days'
    AND event_type IN ('profile_updated','UPDATE') AND table_name = 'profiles';
  INSERT INTO public.refactor_kpi_daily (snapshot_date, metric_key, metric_value, metric_unit, numerator, window_label)
  VALUES (v_today, 'profile_updates_30d', v_profile_updates, 'count', v_profile_updates, 'last_30d')
  ON CONFLICT (snapshot_date, metric_key, window_label) DO UPDATE
    SET metric_value = EXCLUDED.metric_value, numerator = EXCLUDED.numerator, computed_at = now();

  SELECT COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY cnt), 0) INTO v_p95
  FROM (
    SELECT user_id, count(*) AS cnt FROM public.audit_log
    WHERE created_at >= now() - INTERVAL '30 days'
      AND table_name = 'profiles' AND event_type IN ('profile_updated','UPDATE')
      AND user_id IS NOT NULL
    GROUP BY user_id
  ) t;
  INSERT INTO public.refactor_kpi_daily (snapshot_date, metric_key, metric_value, metric_unit, window_label)
  VALUES (v_today, 'profile_edits_per_user_p95', v_p95, 'count', 'last_30d')
  ON CONFLICT (snapshot_date, metric_key, window_label) DO UPDATE
    SET metric_value = EXCLUDED.metric_value, computed_at = now();

  SELECT count(*) INTO v_within5 FROM public.audit_log a
  JOIN public.profiles p ON p.user_id = a.user_id
  WHERE a.created_at >= now() - INTERVAL '30 days'
    AND a.table_name = 'profiles' AND a.event_type IN ('profile_updated','UPDATE')
    AND p.created_at IS NOT NULL
    AND a.created_at - p.created_at < INTERVAL '5 minutes';
  INSERT INTO public.refactor_kpi_daily (snapshot_date, metric_key, metric_value, metric_unit, window_label)
  VALUES (v_today, 'profile_edits_within_5min', v_within5, 'count', 'last_30d')
  ON CONFLICT (snapshot_date, metric_key, window_label) DO UPDATE
    SET metric_value = EXCLUDED.metric_value, computed_at = now();

  SELECT count(*) FILTER (WHERE completed = true),
         count(*) FILTER (WHERE completed = false AND completed_at IS NULL)
  INTO v_task_done, v_task_undone
  FROM public.journey_progress WHERE updated_at >= now() - INTERVAL '30 days';
  INSERT INTO public.refactor_kpi_daily
    (snapshot_date, metric_key, metric_value, metric_unit, numerator, denominator, window_label)
  VALUES (v_today, 'task_uncompletion_pct',
     CASE WHEN (v_task_done + v_task_undone) > 0
          THEN ROUND(100.0 * v_task_undone / (v_task_done + v_task_undone), 2) ELSE 0 END,
     'percent', v_task_undone, v_task_done + v_task_undone, 'last_30d')
  ON CONFLICT (snapshot_date, metric_key, window_label) DO UPDATE
    SET metric_value = EXCLUDED.metric_value, numerator = EXCLUDED.numerator,
        denominator = EXCLUDED.denominator, computed_at = now();

  BEGIN
    SELECT count(*), count(*) FILTER (WHERE status NOT IN ('draft','started'))
    INTO v_app_started, v_app_submitted
    FROM public.general_applications WHERE created_at >= now() - INTERVAL '30 days';
    INSERT INTO public.refactor_kpi_daily
      (snapshot_date, metric_key, metric_value, metric_unit, numerator, denominator, window_label)
    VALUES (v_today, 'general_app_submit_rate',
       CASE WHEN v_app_started > 0 THEN ROUND(100.0 * v_app_submitted / v_app_started, 2) ELSE 0 END,
       'percent', v_app_submitted, v_app_started, 'last_30d')
    ON CONFLICT (snapshot_date, metric_key, window_label) DO UPDATE
      SET metric_value = EXCLUDED.metric_value, numerator = EXCLUDED.numerator,
          denominator = EXCLUDED.denominator, computed_at = now();
  EXCEPTION WHEN OTHERS THEN NULL; END;

  SELECT count(*) INTO v_obj_obj FROM public.audit_log
  WHERE created_at >= now() - INTERVAL '7 days'
    AND ((changed_fields::text ILIKE '%[object Object]%') OR (event_type ILIKE '%[object Object]%'));
  INSERT INTO public.refactor_kpi_daily (snapshot_date, metric_key, metric_value, metric_unit, window_label)
  VALUES (v_today, 'object_object_log_rows', v_obj_obj, 'count', 'last_7d')
  ON CONFLICT (snapshot_date, metric_key, window_label) DO UPDATE
    SET metric_value = EXCLUDED.metric_value, computed_at = now();

  SELECT count(*) INTO v_sw_noise FROM public.audit_log
  WHERE created_at >= now() - INTERVAL '7 days'
    AND (changed_fields::text ILIKE '%serviceWorker%' OR changed_fields::text ILIKE '%/sw.js%'
         OR event_type ILIKE '%service_worker%');
  INSERT INTO public.refactor_kpi_daily (snapshot_date, metric_key, metric_value, metric_unit, window_label)
  VALUES (v_today, 'serviceworker_noise_rows', v_sw_noise, 'count', 'last_7d')
  ON CONFLICT (snapshot_date, metric_key, window_label) DO UPDATE
    SET metric_value = EXCLUDED.metric_value, computed_at = now();

  SELECT count(DISTINCT user_id) INTO v_chunk_brick FROM public.audit_log
  WHERE created_at >= now() - INTERVAL '7 days'
    AND (changed_fields::text ILIKE '%ChunkLoadError%' OR changed_fields::text ILIKE '%Loading chunk%')
    AND NOT (changed_fields::text ILIKE '%UpdateAvailableBanner%');
  INSERT INTO public.refactor_kpi_daily (snapshot_date, metric_key, metric_value, metric_unit, window_label)
  VALUES (v_today, 'chunk_load_brick_sessions', v_chunk_brick, 'count', 'last_7d')
  ON CONFLICT (snapshot_date, metric_key, window_label) DO UPDATE
    SET metric_value = EXCLUDED.metric_value, computed_at = now();

  SELECT count(*) INTO v_provider_miss FROM public.audit_log
  WHERE created_at >= now() - INTERVAL '7 days'
    AND changed_fields::text ILIKE '%useAuth must be used within%';
  INSERT INTO public.refactor_kpi_daily (snapshot_date, metric_key, metric_value, metric_unit, window_label)
  VALUES (v_today, 'useauth_provider_misses', v_provider_miss, 'count', 'last_7d')
  ON CONFLICT (snapshot_date, metric_key, window_label) DO UPDATE
    SET metric_value = EXCLUDED.metric_value, computed_at = now();

  SELECT count(*) INTO v_fs_errors FROM public.audit_log
  WHERE created_at >= now() - INTERVAL '7 days'
    AND changed_fields::text ILIKE '%upstream:transport_error%';
  INSERT INTO public.refactor_kpi_daily (snapshot_date, metric_key, metric_value, metric_unit, window_label)
  VALUES (v_today, 'freescout_transport_errors', v_fs_errors, 'count', 'last_7d')
  ON CONFLICT (snapshot_date, metric_key, window_label) DO UPDATE
    SET metric_value = EXCLUDED.metric_value, computed_at = now();

  BEGIN
    SELECT count(*) INTO v_bulk_rej FROM public.email_send_log
    WHERE created_at >= now() - INTERVAL '30 days'
      AND status IN ('skipped','rate_limited','bulk_capped');
    INSERT INTO public.refactor_kpi_daily (snapshot_date, metric_key, metric_value, metric_unit, window_label)
    VALUES (v_today, 'bulk_cap_rejections', v_bulk_rej, 'count', 'last_30d')
    ON CONFLICT (snapshot_date, metric_key, window_label) DO UPDATE
      SET metric_value = EXCLUDED.metric_value, computed_at = now();
  EXCEPTION WHEN OTHERS THEN NULL; END;

  SELECT count(*) INTO v_country_edits FROM public.audit_log
  WHERE created_at >= now() - INTERVAL '30 days'
    AND table_name = 'profiles'
    AND changed_fields @> ARRAY['country']::text[]
    AND array_length(changed_fields, 1) = 1;
  INSERT INTO public.refactor_kpi_daily (snapshot_date, metric_key, metric_value, metric_unit, window_label)
  VALUES (v_today, 'country_standalone_edits', v_country_edits, 'count', 'last_30d')
  ON CONFLICT (snapshot_date, metric_key, window_label) DO UPDATE
    SET metric_value = EXCLUDED.metric_value, computed_at = now();

  RETURN QUERY
    SELECT d.metric_key, d.metric_value, d.window_label
    FROM public.refactor_kpi_daily d WHERE d.snapshot_date = v_today;
END;
$$;