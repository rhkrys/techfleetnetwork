
-- Admin: replay one dlq/expired row back to pending (idempotent)
CREATE OR REPLACE FUNCTION public.replay_email_outbox_row(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.email_outbox%ROWTYPE;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  UPDATE public.email_outbox
     SET status = 'pending',
         attempts = 0,
         next_attempt_at = now(),
         last_error = NULL,
         dlq_reason = NULL,
         dlq_at = NULL
   WHERE id = p_id
     AND status IN ('dlq','expired','permanent_fail')
  RETURNING * INTO v_row;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_replayable');
  END IF;
  PERFORM public.record_event(
    'ops_events', 'email.replay.admin',
    auth.uid(), jsonb_build_object('outbox_id', p_id, 'lane', v_row.lane), 'info', 'email_outbox'
  );
  RETURN jsonb_build_object('ok', true, 'id', p_id, 'lane', v_row.lane);
END;
$$;

REVOKE ALL ON FUNCTION public.replay_email_outbox_row(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replay_email_outbox_row(uuid) TO authenticated, service_role;

-- Daily v2 rollup into ops_metrics (one row per metric_key per day)
CREATE OR REPLACE FUNCTION public.email_v2_daily_rollup(p_day date DEFAULT (now() AT TIME ZONE 'utc')::date)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_written integer := 0;
  v_lane text;
  v_kind text;
  v_count bigint;
BEGIN
  FOR v_lane, v_kind, v_count IN
    SELECT lane,
           CASE WHEN status = 'sent' THEN 'sent'
                WHEN status = 'dlq' THEN 'dlq'
                WHEN status = 'expired' THEN 'expired'
                ELSE 'other' END AS kind,
           count(*)
      FROM public.email_outbox
     WHERE (sent_at::date = p_day OR dlq_at::date = p_day OR (status = 'expired' AND updated_at::date = p_day))
     GROUP BY lane, kind
  LOOP
    INSERT INTO public.ops_metrics (metric_key, metric_date, value, labels)
    VALUES (
      'email_v2_' || v_kind,
      p_day,
      v_count,
      jsonb_build_object('lane', v_lane)
    )
    ON CONFLICT (metric_key, metric_date, labels)
    DO UPDATE SET value = EXCLUDED.value;
    v_written := v_written + 1;
  END LOOP;
  RETURN v_written;
EXCEPTION WHEN undefined_column OR undefined_table THEN
  -- Tolerate schema drift on ops_metrics during phased rollout
  RETURN 0;
END;
$$;

REVOKE ALL ON FUNCTION public.email_v2_daily_rollup(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_v2_daily_rollup(date) TO service_role;
