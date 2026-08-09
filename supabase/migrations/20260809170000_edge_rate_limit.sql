-- Audit Wave 2 T-H: a generic, dedicated per-identity rate limiter for public /
-- unauthenticated edge endpoints (record-web-vital, get-i18n-bundle, and future
-- adopters). Kept SEPARATE from the auth-critical check_rate_limit (whose action
-- whitelist we must not touch). Deny-by-default RLS; only the SECURITY DEFINER
-- RPC (+ service_role) can read/write. Identifier is hashed at rest; self-cleaning.
--
-- Generalizes the translation limiter (20260809140000) with an action bucket so
-- multiple endpoints share one table with independent counters.

BEGIN;

CREATE TABLE IF NOT EXISTS public.edge_rate_limits (
  identifier_hash text NOT NULL,   -- sha256(action || ':' || identifier)
  window_start    timestamptz NOT NULL,
  count           integer NOT NULL DEFAULT 0,
  PRIMARY KEY (identifier_hash, window_start)
);

ALTER TABLE public.edge_rate_limits ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_edge_rate_limits_window
  ON public.edge_rate_limits (window_start);

CREATE OR REPLACE FUNCTION public.check_edge_rate_limit(
  p_identifier text,
  p_action text,
  p_max integer DEFAULT 60,
  p_window_minutes integer DEFAULT 1
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hash   text := encode(extensions.digest(p_action || ':' || p_identifier, 'sha256'), 'hex');
  v_secs   integer := GREATEST(p_window_minutes, 1) * 60;
  v_window timestamptz := to_timestamp(floor(extract(epoch FROM now()) / v_secs) * v_secs);
  v_count  integer;
BEGIN
  INSERT INTO public.edge_rate_limits (identifier_hash, window_start, count)
  VALUES (v_hash, v_window, 1)
  ON CONFLICT (identifier_hash, window_start)
  DO UPDATE SET count = public.edge_rate_limits.count + 1
  RETURNING count INTO v_count;

  DELETE FROM public.edge_rate_limits
   WHERE identifier_hash = v_hash AND window_start < v_window;

  RETURN json_build_object('allowed', v_count <= p_max, 'count', v_count, 'limit', p_max);
END;
$$;

REVOKE ALL ON FUNCTION public.check_edge_rate_limit(text, text, integer, integer)
  FROM public, anon, authenticated;

COMMIT;
