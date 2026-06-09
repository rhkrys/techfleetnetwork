-- 1) Admin RPC to clear a stuck email lane cooldown, with audit trail.
CREATE OR REPLACE FUNCTION public.clear_email_lane_cooldown(p_lane text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_cooldown_col text;
  v_counter_col text;
  v_prev_until timestamptz;
  v_prev_count integer;
BEGIN
  IF v_actor IS NULL OR NOT public.has_role(v_actor, 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF p_lane NOT IN ('auth_emails','transactional_emails','bulk_emails') THEN
    RAISE EXCEPTION 'invalid lane: %', p_lane USING ERRCODE = '22023';
  END IF;

  v_cooldown_col := CASE p_lane
    WHEN 'auth_emails' THEN 'auth_retry_after_until'
    WHEN 'transactional_emails' THEN 'transactional_retry_after_until'
    WHEN 'bulk_emails' THEN 'bulk_retry_after_until'
  END;
  v_counter_col := CASE p_lane
    WHEN 'auth_emails' THEN 'auth_consecutive_rate_limits'
    WHEN 'transactional_emails' THEN 'transactional_consecutive_rate_limits'
    WHEN 'bulk_emails' THEN 'bulk_consecutive_rate_limits'
  END;

  EXECUTE format(
    'UPDATE public.email_send_state SET %I = NULL, %I = 0, updated_at = now() WHERE id = 1 RETURNING (SELECT %I FROM public.email_send_state WHERE id = 1)',
    v_cooldown_col, v_counter_col, v_cooldown_col
  );

  PERFORM public.record_event(
    'audit_log'::text,
    'email_lane_cooldown_cleared'::text,
    v_actor,
    jsonb_build_object('lane', p_lane),
    'info'::text,
    'email_send_state'::text
  );

  RETURN jsonb_build_object('ok', true, 'lane', p_lane);
END;
$$;

REVOKE ALL ON FUNCTION public.clear_email_lane_cooldown(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clear_email_lane_cooldown(text) TO authenticated, service_role;

-- 2) Immediate unfreeze of the active incident so the 112 pending bulk rows drain on next cron tick.
UPDATE public.email_send_state
   SET bulk_retry_after_until = NULL,
       bulk_consecutive_rate_limits = 0,
       updated_at = now()
 WHERE id = 1
   AND bulk_retry_after_until IS NOT NULL
   AND bulk_retry_after_until > now();