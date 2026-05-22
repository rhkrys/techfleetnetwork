
-- ============================================================
-- Login telemetry: per-attempt observability + admin RPC
-- ============================================================

-- 1) Table
CREATE TABLE IF NOT EXISTS public.login_attempts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempt_id      UUID NOT NULL,
  outcome         TEXT NOT NULL,
  branch          TEXT,
  http_status     INT,
  duration_ms     INT,
  request_id      TEXT,
  email_hash      TEXT,
  email_domain    TEXT,
  ip_hash         TEXT,
  user_agent_short TEXT,
  origin_host     TEXT,
  user_id         UUID
);

CREATE INDEX IF NOT EXISTS login_attempts_created_idx ON public.login_attempts (created_at DESC);
CREATE INDEX IF NOT EXISTS login_attempts_outcome_idx ON public.login_attempts (outcome, created_at DESC);
CREATE INDEX IF NOT EXISTS login_attempts_attempt_idx ON public.login_attempts (attempt_id);
CREATE INDEX IF NOT EXISTS login_attempts_email_hash_idx ON public.login_attempts (email_hash, created_at DESC);

ALTER TABLE public.login_attempts ENABLE ROW LEVEL SECURITY;

-- Admin-only read
DROP POLICY IF EXISTS login_attempts_admin_select ON public.login_attempts;
CREATE POLICY login_attempts_admin_select
  ON public.login_attempts
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- No direct insert/update/delete from clients; writes flow through SECURITY DEFINER RPC.
REVOKE INSERT, UPDATE, DELETE ON public.login_attempts FROM anon, authenticated;

-- 2) Allowed outcomes
CREATE OR REPLACE FUNCTION public._login_outcome_allowed(o TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT o = ANY (ARRAY[
    'started','captcha_loaded','captcha_blocked','captcha_failed',
    'edge_entered','domain_reject','auth_throttle','invalid_credentials',
    'session_set','mfa_required','redirected','session_incomplete',
    'network_error','server_error','stale_chunk_recovery',
    'magic_link_sent','magic_link_failed','unknown'
  ]);
$$;

REVOKE EXECUTE ON FUNCTION public._login_outcome_allowed(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._login_outcome_allowed(TEXT) TO anon, authenticated, service_role;

-- 3) Server-side salted hash (uses pgcrypto digest)
CREATE OR REPLACE FUNCTION public._login_hash(value TEXT)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  salt TEXT;
BEGIN
  IF value IS NULL OR length(value) = 0 THEN
    RETURN NULL;
  END IF;
  -- Reuse an existing project-wide secret; fall back to a stable per-DB constant.
  -- This is not a cryptographic secret store, just a defense against trivial rainbow tables.
  salt := COALESCE(current_setting('app.login_salt', true), 'tfn-login-hash-v1');
  RETURN encode(extensions.digest(salt || ':' || lower(trim(value)), 'sha256'), 'hex');
END;
$$;

REVOKE EXECUTE ON FUNCTION public._login_hash(TEXT) FROM PUBLIC, anon, authenticated;

-- 4) Public RPC: record_login_event
CREATE OR REPLACE FUNCTION public.record_login_event(
  p_attempt_id   UUID,
  p_outcome      TEXT,
  p_branch       TEXT       DEFAULT NULL,
  p_http_status  INT        DEFAULT NULL,
  p_duration_ms  INT        DEFAULT NULL,
  p_email        TEXT       DEFAULT NULL,
  p_ip           TEXT       DEFAULT NULL,
  p_user_agent   TEXT       DEFAULT NULL,
  p_origin_host  TEXT       DEFAULT NULL,
  p_request_id   TEXT       DEFAULT NULL,
  p_user_id      UUID       DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email_domain TEXT;
  v_recent_count INT;
BEGIN
  -- Validate inputs (silently no-op on bad payloads; never raise to client)
  IF p_attempt_id IS NULL THEN RETURN; END IF;
  IF NOT public._login_outcome_allowed(p_outcome) THEN RETURN; END IF;

  -- Per-attempt rate-limit: max ~25 events per 5 minutes
  SELECT count(*) INTO v_recent_count
    FROM public.login_attempts
   WHERE attempt_id = p_attempt_id
     AND created_at > now() - interval '5 minutes';
  IF v_recent_count >= 25 THEN RETURN; END IF;

  IF p_email IS NOT NULL AND position('@' IN p_email) > 0 THEN
    v_email_domain := lower(split_part(p_email, '@', 2));
  END IF;

  INSERT INTO public.login_attempts (
    attempt_id, outcome, branch, http_status, duration_ms,
    request_id, email_hash, email_domain, ip_hash,
    user_agent_short, origin_host, user_id
  ) VALUES (
    p_attempt_id,
    p_outcome,
    NULLIF(left(coalesce(p_branch,''), 64), ''),
    p_http_status,
    p_duration_ms,
    NULLIF(left(coalesce(p_request_id,''), 64), ''),
    public._login_hash(p_email),
    NULLIF(left(coalesce(v_email_domain,''), 253), ''),
    public._login_hash(p_ip),
    NULLIF(left(coalesce(p_user_agent,''), 120), ''),
    NULLIF(left(coalesce(p_origin_host,''), 253), ''),
    p_user_id
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_login_event(UUID, TEXT, TEXT, INT, INT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_login_event(UUID, TEXT, TEXT, INT, INT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID)
  TO anon, authenticated, service_role;

-- 5) Admin dashboard RPC: get_login_health
CREATE OR REPLACE FUNCTION public.get_login_health(p_window_minutes INT DEFAULT 1440)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start TIMESTAMPTZ := now() - make_interval(mins => GREATEST(5, LEAST(p_window_minutes, 10080)));
  v_started INT;
  v_redirected INT;
  v_edge_entered INT;
  v_p95 INT;
  v_unique_failed INT;
  v_kpis JSONB;
  v_buckets JSONB;
  v_branches JSONB;
  v_domains JSONB;
  v_recent JSONB;
  v_alerts JSONB;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'admin role required' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) FILTER (WHERE outcome = 'started'),
         count(*) FILTER (WHERE outcome = 'redirected'),
         count(*) FILTER (WHERE outcome = 'edge_entered'),
         coalesce(percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms)::INT, 0),
         count(DISTINCT email_hash) FILTER (WHERE outcome IN (
           'invalid_credentials','session_incomplete','server_error',
           'network_error','captcha_failed','captcha_blocked','auth_throttle'
         ))
    INTO v_started, v_redirected, v_edge_entered, v_p95, v_unique_failed
    FROM public.login_attempts
   WHERE created_at >= v_start;

  v_kpis := jsonb_build_object(
    'window_minutes', p_window_minutes,
    'started', coalesce(v_started, 0),
    'redirected', coalesce(v_redirected, 0),
    'edge_entered', coalesce(v_edge_entered, 0),
    'success_rate',
      CASE WHEN coalesce(v_started, 0) > 0
        THEN round((coalesce(v_redirected, 0)::numeric / v_started) * 100, 1)
        ELSE NULL END,
    'p95_duration_ms', coalesce(v_p95, 0),
    'unique_failed_members', coalesce(v_unique_failed, 0)
  );

  SELECT coalesce(jsonb_agg(b ORDER BY (b->>'bucket_start')), '[]'::jsonb)
    INTO v_buckets
    FROM (
      SELECT jsonb_build_object(
               'bucket_start', date_trunc('hour', created_at)
                                 + (floor(extract(minute FROM created_at)/5) * interval '5 minutes'),
               'outcome', outcome,
               'count', count(*)
             ) AS b
        FROM public.login_attempts
       WHERE created_at >= v_start
       GROUP BY 1
    ) s
   CROSS JOIN LATERAL (SELECT b) _;

  -- (Re-shape above into clean rows — workaround for cross-lateral mess)
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'bucket_start', bucket_start,
           'outcome', outcome,
           'count', cnt
         ) ORDER BY bucket_start), '[]'::jsonb)
    INTO v_buckets
    FROM (
      SELECT date_trunc('hour', created_at)
               + (floor(extract(minute FROM created_at)/5) * interval '5 minutes') AS bucket_start,
             outcome,
             count(*) AS cnt
        FROM public.login_attempts
       WHERE created_at >= v_start
       GROUP BY 1, 2
    ) s;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'outcome', outcome,
           'count', cnt,
           'last_seen', last_seen,
           'sample_request_id', sample_request_id
         ) ORDER BY cnt DESC), '[]'::jsonb)
    INTO v_branches
    FROM (
      SELECT outcome,
             count(*) AS cnt,
             max(created_at) AS last_seen,
             (array_agg(request_id ORDER BY created_at DESC) FILTER (WHERE request_id IS NOT NULL))[1] AS sample_request_id
        FROM public.login_attempts
       WHERE created_at >= v_start
       GROUP BY outcome
    ) s;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'domain', email_domain,
           'count', cnt
         ) ORDER BY cnt DESC), '[]'::jsonb)
    INTO v_domains
    FROM (
      SELECT email_domain, count(*) AS cnt
        FROM public.login_attempts
       WHERE created_at >= v_start
         AND email_domain IS NOT NULL
         AND outcome IN ('invalid_credentials','captcha_failed','captcha_blocked',
                         'server_error','network_error','session_incomplete','auth_throttle')
       GROUP BY email_domain
       ORDER BY cnt DESC
       LIMIT 10
    ) s;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'created_at', created_at,
           'outcome', outcome,
           'branch', branch,
           'http_status', http_status,
           'duration_ms', duration_ms,
           'email_domain', email_domain,
           'request_id', request_id
         ) ORDER BY created_at DESC), '[]'::jsonb)
    INTO v_recent
    FROM (
      SELECT created_at, outcome, branch, http_status, duration_ms, email_domain, request_id
        FROM public.login_attempts
       WHERE created_at >= v_start
         AND outcome NOT IN ('started','captcha_loaded','edge_entered','session_set','redirected')
       ORDER BY created_at DESC
       LIMIT 50
    ) s;

  -- Live alerts
  v_alerts := jsonb_build_object(
    'success_rate_low',
      (coalesce(v_started,0) >= 20
       AND coalesce((v_kpis->>'success_rate')::numeric, 100) < 95),
    'edge_unreachable',
      (coalesce(v_started,0) >= 10 AND coalesce(v_edge_entered,0) = 0),
    'captcha_blocked_high',
      EXISTS (
        SELECT 1 FROM public.login_attempts
         WHERE created_at >= now() - interval '15 minutes'
         GROUP BY 1=1
        HAVING count(*) FILTER (WHERE outcome='captcha_blocked')::numeric
             / NULLIF(count(*) FILTER (WHERE outcome='started'),0) > 0.05
      ),
    'server_or_session_errors_high',
      EXISTS (
        SELECT 1 FROM public.login_attempts
         WHERE created_at >= now() - interval '15 minutes'
         GROUP BY 1=1
        HAVING count(*) FILTER (WHERE outcome IN ('server_error','session_incomplete'))::numeric
             / NULLIF(count(*) FILTER (WHERE outcome='started'),0) > 0.01
      )
  );

  RETURN jsonb_build_object(
    'generated_at', now(),
    'kpis',     v_kpis,
    'buckets',  v_buckets,
    'branches', v_branches,
    'top_failing_domains', v_domains,
    'recent_failures', v_recent,
    'alerts',  v_alerts
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_login_health(INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_login_health(INT) TO authenticated, service_role;

-- 6) Retention: prune rows > 30 days (called by nightly cleanup cron if present)
CREATE OR REPLACE FUNCTION public.prune_login_attempts()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_deleted INT;
BEGIN
  DELETE FROM public.login_attempts WHERE created_at < now() - interval '30 days';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.prune_login_attempts() FROM PUBLIC, anon, authenticated;
