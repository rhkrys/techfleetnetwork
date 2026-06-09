
-- Auth Funnel: aggregate ops_events rows emitted by the rebuilt auth feature
-- into stage counts. Admin-only; reads from telemetry sink only (never audit_log).
CREATE OR REPLACE FUNCTION public.get_auth_funnel_counts(p_window text DEFAULT '24h')
RETURNS TABLE (stage text, count bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_since timestamptz;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_since := CASE p_window
    WHEN '1h'  THEN now() - interval '1 hour'
    WHEN '24h' THEN now() - interval '24 hours'
    WHEN '7d'  THEN now() - interval '7 days'
    ELSE now() - interval '24 hours'
  END;

  RETURN QUERY
  SELECT
    CASE
      WHEN kind = 'auth.signin.start'                       THEN 'submit'
      WHEN kind = 'auth.signin.captcha_required'            THEN 'captcha'
      WHEN kind = 'auth.signin.captcha_failed'              THEN 'captcha_failed'
      WHEN kind = 'auth.mfa.required'                       THEN 'mfa'
      WHEN kind = 'auth.mfa.invalid_code'                   THEN 'mfa_failed'
      WHEN kind = 'auth.signin.success'                     THEN 'signed_in'
      WHEN kind = 'auth.signin.client_session_write_failed' THEN 'session_write_failed'
      WHEN kind = 'auth.signin.invalid_credentials'         THEN 'invalid_credentials'
      WHEN kind = 'auth.signin.rate_limited'                THEN 'rate_limited'
      WHEN kind = 'auth.signin.account_locked'              THEN 'account_locked'
      WHEN kind LIKE 'auth.signin.%'                        THEN 'other_failure'
      ELSE 'other'
    END AS stage,
    count(*)::bigint AS count
  FROM public.ops_events
  WHERE kind LIKE 'auth.%'
    AND created_at >= v_since
  GROUP BY 1
  ORDER BY 2 DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_auth_funnel_counts(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_auth_funnel_counts(text) TO authenticated, service_role;

-- Prober health: latest outcome per stage + simple two-strike flag.
CREATE OR REPLACE FUNCTION public.get_auth_prober_health()
RETURNS TABLE (
  stage text,
  latest_outcome text,
  latest_error_code text,
  latest_latency_ms integer,
  latest_at timestamptz,
  two_strike boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH ranked AS (
    SELECT
      r.stage,
      r.outcome,
      r.error_code,
      r.latency_ms,
      r.created_at,
      row_number() OVER (PARTITION BY r.stage ORDER BY r.created_at DESC) AS rn
    FROM public.auth_prober_results r
    WHERE r.created_at >= now() - interval '24 hours'
  )
  SELECT
    stage,
    max(outcome)        FILTER (WHERE rn = 1) AS latest_outcome,
    max(error_code)     FILTER (WHERE rn = 1) AS latest_error_code,
    max(latency_ms)     FILTER (WHERE rn = 1) AS latest_latency_ms,
    max(created_at)     FILTER (WHERE rn = 1) AS latest_at,
    bool_and(outcome = 'err') FILTER (WHERE rn <= 2) AS two_strike
  FROM ranked
  GROUP BY stage
  ORDER BY stage;
END;
$$;

REVOKE ALL ON FUNCTION public.get_auth_prober_health() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_auth_prober_health() TO authenticated, service_role;
