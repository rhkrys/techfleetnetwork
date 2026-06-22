-- 1. i18n_translations: composite index for (locale, namespace, key=ANY()) lookup
CREATE INDEX IF NOT EXISTS idx_i18n_translations_locale_ns_key
  ON public.i18n_translations (locale, namespace, key);

-- 2. ugc_translations: BRIN-style support for created_at sort + fast count
CREATE INDEX IF NOT EXISTS idx_ugc_translations_created_at_desc
  ON public.ugc_translations (created_at DESC);

CREATE OR REPLACE FUNCTION public.ugc_translations_count_fast(
  p_since timestamptz DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_estimate bigint;
  v_count bigint;
  v_plan jsonb;
BEGIN
  -- Caller must be service_role or admin (worker + System Health only)
  IF NOT (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR current_setting('request.jwt.claims', true)::jsonb ->> 'role' = 'service_role'
    OR current_user = 'service_role'
  ) THEN
    RAISE EXCEPTION 'admin or service role required' USING ERRCODE = '42501';
  END IF;

  IF p_since IS NULL THEN
    SELECT GREATEST(reltuples, 0)::bigint INTO v_estimate
    FROM pg_class WHERE oid = 'public.ugc_translations'::regclass;
    RETURN COALESCE(v_estimate, 0);
  END IF;

  EXECUTE 'EXPLAIN (FORMAT JSON) SELECT 1 FROM public.ugc_translations WHERE created_at >= $1'
    INTO v_plan USING p_since;
  v_estimate := COALESCE((v_plan -> 0 -> 'Plan' ->> 'Plan Rows')::bigint, 0);

  IF v_estimate <= 50000 THEN
    EXECUTE 'SELECT count(*) FROM public.ugc_translations WHERE created_at >= $1'
      INTO v_count USING p_since;
    RETURN v_count;
  END IF;

  RETURN v_estimate;
END;
$$;

REVOKE ALL ON FUNCTION public.ugc_translations_count_fast(timestamptz) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.ugc_translations_count_fast(timestamptz) TO authenticated, service_role;

-- 3. cookie_consents: dedupe index — newest row per identifier (used by record-consent edge fn)
CREATE INDEX IF NOT EXISTS idx_cookie_consents_user_id_created_at_desc
  ON public.cookie_consents (user_id, created_at DESC) WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cookie_consents_anon_id_created_at_desc
  ON public.cookie_consents (anon_id, created_at DESC) WHERE anon_id IS NOT NULL;

-- 4. journey_progress: idempotency guard — same (user_id, phase, task_id, completed) within 2s is a no-op upsert. Index already exists on the unique key; nothing more needed.

ANALYZE public.i18n_translations;
ANALYZE public.ugc_translations;
ANALYZE public.cookie_consents;