
-- 1. Allow new 'identity_check' action in rate-limit functions.
CREATE OR REPLACE FUNCTION public.check_rate_limit(p_identifier text, p_action text, p_max_attempts integer DEFAULT 5, p_window_minutes integer DEFAULT 1, p_block_minutes integer DEFAULT 5)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_record record;
  v_now timestamptz := now();
  v_lock_key bigint;
  v_identifier text := lower(trim(coalesce(p_identifier, '')));
  v_action text := lower(trim(coalesce(p_action, '')));
BEGIN
  IF v_identifier !~ '^[a-f0-9]{64}$' THEN
    RETURN json_build_object('allowed', false, 'remaining', 0, 'retry_after', 60);
  END IF;

  IF v_action NOT IN ('login_attempt', 'signup_attempt', 'signup_resend', 'password_reset', 'identity_check') THEN
    RETURN json_build_object('allowed', false, 'remaining', 0, 'retry_after', 60);
  END IF;

  p_max_attempts := CASE
    WHEN v_action = 'login_attempt' THEN least(greatest(coalesce(p_max_attempts, 6), 1), 10)
    WHEN v_action = 'signup_resend' THEN least(greatest(coalesce(p_max_attempts, 5), 1), 10)
    WHEN v_action = 'identity_check' THEN least(greatest(coalesce(p_max_attempts, 10), 1), 20)
    ELSE least(greatest(coalesce(p_max_attempts, 3), 1), 5)
  END;
  p_window_minutes := least(greatest(coalesce(p_window_minutes, 15), 1), 60);
  p_block_minutes := least(greatest(coalesce(p_block_minutes, 60), 1), 1440);

  v_lock_key := hashtextextended(v_identifier || ':' || v_action, 0);
  PERFORM pg_advisory_xact_lock(v_lock_key);

  SELECT * INTO v_record
  FROM public.rate_limits
  WHERE identifier = v_identifier AND action = v_action
  ORDER BY window_start DESC
  LIMIT 1
  FOR UPDATE;

  IF v_record IS NOT NULL AND v_record.blocked_until IS NOT NULL THEN
    IF v_record.blocked_until > v_now THEN
      RETURN json_build_object(
        'allowed', false,
        'remaining', 0,
        'retry_after', extract(epoch from (v_record.blocked_until - v_now))::int
      );
    ELSE
      DELETE FROM public.rate_limits WHERE id = v_record.id;
      v_record := NULL;
    END IF;
  END IF;

  IF v_record IS NULL THEN
    INSERT INTO public.rate_limits (identifier, action, attempt_count, window_start)
    VALUES (v_identifier, v_action, 1, v_now);
    RETURN json_build_object('allowed', true, 'remaining', p_max_attempts - 1, 'retry_after', 0);
  END IF;

  UPDATE public.rate_limits
  SET attempt_count = v_record.attempt_count + 1,
      blocked_until = CASE
        WHEN v_record.attempt_count + 1 > p_max_attempts
        THEN v_now + (p_block_minutes || ' minutes')::interval
        ELSE NULL
      END
  WHERE id = v_record.id;

  IF v_record.attempt_count + 1 > p_max_attempts THEN
    RETURN json_build_object('allowed', false, 'remaining', 0, 'retry_after', p_block_minutes * 60);
  END IF;

  RETURN json_build_object(
    'allowed', true,
    'remaining', greatest(0, p_max_attempts - (v_record.attempt_count + 1)),
    'retry_after', 0
  );
END;
$function$;

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
  IF v_action NOT IN ('login_attempt', 'signup_attempt', 'signup_resend', 'password_reset', 'identity_check') THEN
    RETURN json_build_object('allowed', false, 'remaining', 0, 'retry_after', 60);
  END IF;

  p_max_attempts := CASE
    WHEN v_action = 'login_attempt' THEN least(greatest(coalesce(p_max_attempts, 6), 1), 10)
    WHEN v_action = 'signup_resend' THEN least(greatest(coalesce(p_max_attempts, 5), 1), 10)
    WHEN v_action = 'identity_check' THEN least(greatest(coalesce(p_max_attempts, 10), 1), 20)
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

-- 2. Drain any active password_reset blocks created by the old broad-catch behavior
-- so affected members can immediately request a reset link again.
DELETE FROM public.rate_limits
WHERE action = 'password_reset'
  AND blocked_until IS NOT NULL
  AND blocked_until > now();

-- 3. Drain login_attempt rows that were populated by identity-check probes
-- (action was wrong; now isolated into identity_check bucket).
DELETE FROM public.rate_limits
WHERE action = 'login_attempt'
  AND blocked_until IS NOT NULL
  AND blocked_until > now()
  AND attempt_count <= 10;
