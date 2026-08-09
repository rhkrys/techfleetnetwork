-- Audit Wave 1 — H15: cap unauthenticated LLM spend on translate-strings /
-- translate-bundle. Those functions only checked that the Authorization header
-- started with "Bearer " (any string passed) and had NO rate limit, so anyone
-- with the public anon key could drain the shared LOVABLE_API_KEY (breaking
-- Fleety + triage). The edge functions now (a) validate a genuine Supabase JWT
-- via getClaims and (b) enforce this per-identity rate limit as the spend ceiling.
--
-- A DEDICATED limiter (separate table + RPC) so we never touch the auth-critical
-- check_rate_limit whitelist. Deny-by-default RLS; only the SECURITY DEFINER RPC
-- (and service_role) can read/write. Self-cleaning per identity.

BEGIN;

CREATE TABLE IF NOT EXISTS public.translation_rate_limits (
  identifier_hash text NOT NULL,
  window_start    timestamptz NOT NULL,
  count           integer NOT NULL DEFAULT 0,
  PRIMARY KEY (identifier_hash, window_start)
);

ALTER TABLE public.translation_rate_limits ENABLE ROW LEVEL SECURITY;
-- No policies: deny-by-default. The SECURITY DEFINER RPC below and the service
-- role are the only writers/readers; anon/authenticated get nothing.

CREATE INDEX IF NOT EXISTS idx_translation_rate_limits_window
  ON public.translation_rate_limits (window_start);

-- Atomic count-and-check for a fixed-size time bucket. p_identifier is hashed
-- here so raw IPs/uids are never stored. Returns { allowed, count, limit }.
CREATE OR REPLACE FUNCTION public.check_translation_rate_limit(
  p_identifier text,
  p_max integer DEFAULT 30,
  p_window_minutes integer DEFAULT 1
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hash   text := encode(extensions.digest(p_identifier, 'sha256'), 'hex');
  v_secs   integer := GREATEST(p_window_minutes, 1) * 60;
  v_window timestamptz := to_timestamp(floor(extract(epoch FROM now()) / v_secs) * v_secs);
  v_count  integer;
BEGIN
  INSERT INTO public.translation_rate_limits (identifier_hash, window_start, count)
  VALUES (v_hash, v_window, 1)
  ON CONFLICT (identifier_hash, window_start)
  DO UPDATE SET count = public.translation_rate_limits.count + 1
  RETURNING count INTO v_count;

  -- Self-clean this identity's stale buckets (cheap, keyed).
  DELETE FROM public.translation_rate_limits
   WHERE identifier_hash = v_hash AND window_start < v_window;

  RETURN json_build_object('allowed', v_count <= p_max, 'count', v_count, 'limit', p_max);
END;
$$;

REVOKE ALL ON FUNCTION public.check_translation_rate_limit(text, integer, integer)
  FROM public, anon, authenticated;

COMMIT;
