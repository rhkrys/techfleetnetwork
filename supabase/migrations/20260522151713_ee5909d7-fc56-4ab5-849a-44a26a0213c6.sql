
-- LCL-FIX-006: peek_rate_limit treats stale windows as a fresh start.
CREATE OR REPLACE FUNCTION public.peek_rate_limit(
  p_identifier text,
  p_action text,
  p_max_attempts integer DEFAULT 5,
  p_window_minutes integer DEFAULT 15,
  p_block_minutes integer DEFAULT 60
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_record record;
  v_now timestamptz := now();
  v_identifier text := lower(trim(coalesce(p_identifier, '')));
  v_action text := lower(trim(coalesce(p_action, '')));
  v_window interval;
BEGIN
  IF v_identifier !~ '^[a-f0-9]{64}$' THEN
    RETURN json_build_object('allowed', false, 'remaining', 0, 'retry_after', 60);
  END IF;
  IF v_action NOT IN ('login_attempt', 'signup_attempt', 'signup_resend', 'password_reset') THEN
    RETURN json_build_object('allowed', false, 'remaining', 0, 'retry_after', 60);
  END IF;

  p_max_attempts := CASE
    WHEN v_action = 'login_attempt' THEN least(greatest(coalesce(p_max_attempts, 6), 1), 10)
    WHEN v_action = 'signup_resend' THEN least(greatest(coalesce(p_max_attempts, 5), 1), 10)
    ELSE least(greatest(coalesce(p_max_attempts, 3), 1), 5)
  END;
  v_window := make_interval(mins => least(greatest(coalesce(p_window_minutes, 15), 1), 60));

  SELECT * INTO v_record
  FROM public.rate_limits
  WHERE identifier = v_identifier AND action = v_action
  ORDER BY window_start DESC
  LIMIT 1;

  IF v_record IS NULL THEN
    RETURN json_build_object('allowed', true, 'remaining', p_max_attempts, 'retry_after', 0);
  END IF;

  IF v_record.blocked_until IS NOT NULL AND v_record.blocked_until > v_now THEN
    RETURN json_build_object(
      'allowed', false,
      'remaining', 0,
      'retry_after', extract(epoch from (v_record.blocked_until - v_now))::int
    );
  END IF;

  -- Window expired -> bucket is stale; treat as fresh start.
  IF v_record.window_start < (v_now - v_window) THEN
    RETURN json_build_object('allowed', true, 'remaining', p_max_attempts, 'retry_after', 0);
  END IF;

  RETURN json_build_object(
    'allowed', true,
    'remaining', greatest(0, p_max_attempts - v_record.attempt_count),
    'retry_after', 0
  );
END;
$function$;

-- Periodic prune for stale rate_limits rows.
CREATE OR REPLACE FUNCTION public.prune_stale_rate_limits()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_count integer;
BEGIN
  WITH deleted AS (
    DELETE FROM public.rate_limits
    WHERE (blocked_until IS NULL OR blocked_until < now())
      AND window_start < now() - interval '24 hours'
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM deleted;
  RETURN coalesce(v_count, 0);
END;
$function$;

REVOKE ALL ON FUNCTION public.prune_stale_rate_limits() FROM PUBLIC, anon, authenticated;

-- Schedule 5-minute cron (idempotent — unschedule prior job by name if present).
DO $$
DECLARE
  v_jobid bigint;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'prune-stale-rate-limits';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;
  PERFORM cron.schedule(
    'prune-stale-rate-limits',
    '*/5 * * * *',
    $cron$SELECT public.prune_stale_rate_limits();$cron$
  );
END $$;
