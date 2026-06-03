
CREATE TABLE IF NOT EXISTS public.request_idempotency (
  key            TEXT PRIMARY KEY,
  user_id        UUID,
  request_hash   TEXT NOT NULL,
  response_json  JSONB,
  status         TEXT NOT NULL DEFAULT 'in_flight' CHECK (status IN ('in_flight','complete','failed')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at     TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '24 hours')
);

CREATE INDEX IF NOT EXISTS idx_request_idempotency_expires_at
  ON public.request_idempotency(expires_at);
CREATE INDEX IF NOT EXISTS idx_request_idempotency_user
  ON public.request_idempotency(user_id, created_at DESC) WHERE user_id IS NOT NULL;

ALTER TABLE public.request_idempotency ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role manages request_idempotency" ON public.request_idempotency;
CREATE POLICY "service_role manages request_idempotency"
  ON public.request_idempotency FOR ALL TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "users read own idempotency" ON public.request_idempotency;
CREATE POLICY "users read own idempotency"
  ON public.request_idempotency FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

GRANT SELECT ON public.request_idempotency TO authenticated;
GRANT ALL    ON public.request_idempotency TO service_role;

CREATE OR REPLACE FUNCTION public.claim_idempotency_key(
  p_key TEXT,
  p_user_id UUID,
  p_request_hash TEXT,
  p_ttl_minutes INT DEFAULT 1440
) RETURNS TABLE(claimed BOOLEAN, cached_response JSONB, status TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing RECORD;
BEGIN
  IF p_key IS NULL OR length(p_key) < 8 OR length(p_key) > 200 THEN
    RAISE EXCEPTION 'invalid idempotency key';
  END IF;

  SELECT * INTO v_existing
  FROM public.request_idempotency
  WHERE key = p_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.expires_at < now() THEN
      DELETE FROM public.request_idempotency WHERE key = p_key;
    ELSIF v_existing.request_hash <> p_request_hash THEN
      RAISE EXCEPTION 'idempotency key reused with different payload';
    ELSE
      RETURN QUERY SELECT false, v_existing.response_json, v_existing.status;
      RETURN;
    END IF;
  END IF;

  INSERT INTO public.request_idempotency (key, user_id, request_hash, expires_at)
  VALUES (p_key, p_user_id, p_request_hash, now() + make_interval(mins => p_ttl_minutes));

  RETURN QUERY SELECT true, NULL::JSONB, 'in_flight'::TEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_idempotency_key(TEXT,UUID,TEXT,INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_idempotency_key(TEXT,UUID,TEXT,INT) FROM anon;
GRANT EXECUTE ON FUNCTION public.claim_idempotency_key(TEXT,UUID,TEXT,INT) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.complete_idempotency(
  p_key TEXT,
  p_response JSONB,
  p_status TEXT DEFAULT 'complete'
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_status NOT IN ('complete','failed') THEN
    RAISE EXCEPTION 'invalid status: %', p_status;
  END IF;

  UPDATE public.request_idempotency
     SET response_json = p_response,
         status = p_status
   WHERE key = p_key;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_idempotency(TEXT,JSONB,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_idempotency(TEXT,JSONB,TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.complete_idempotency(TEXT,JSONB,TEXT) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.cleanup_request_idempotency()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted INT;
BEGIN
  DELETE FROM public.request_idempotency WHERE expires_at < now();
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_request_idempotency() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cleanup_request_idempotency() FROM anon;
REVOKE ALL ON FUNCTION public.cleanup_request_idempotency() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_request_idempotency() TO service_role;
