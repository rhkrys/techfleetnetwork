CREATE OR REPLACE FUNCTION public.audit_log_count_fast(
  p_event_type text DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_count bigint;
  v_estimate bigint;
  v_plan jsonb;
  v_where text := '';
  v_sql text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'admin role required' USING ERRCODE = '42501';
  END IF;

  IF p_event_type IS NULL AND p_from IS NULL AND p_to IS NULL THEN
    SELECT GREATEST(reltuples, 0)::bigint INTO v_estimate
    FROM pg_class
    WHERE oid = 'public.audit_log'::regclass;
    RETURN COALESCE(v_estimate, 0);
  END IF;

  IF p_event_type IS NOT NULL THEN
    v_where := v_where || ' AND event_type = $1';
  END IF;
  IF p_from IS NOT NULL THEN
    v_where := v_where || ' AND created_at >= $2';
  END IF;
  IF p_to IS NOT NULL THEN
    v_where := v_where || ' AND created_at <= $3';
  END IF;
  v_where := 'WHERE TRUE' || v_where;

  v_sql := 'EXPLAIN (FORMAT JSON) SELECT 1 FROM public.audit_log ' || v_where;
  EXECUTE v_sql INTO v_plan USING p_event_type, p_from, p_to;
  v_estimate := COALESCE((v_plan -> 0 -> 'Plan' ->> 'Plan Rows')::bigint, 0);

  IF v_estimate <= 50000 THEN
    v_sql := 'SELECT count(*) FROM public.audit_log ' || v_where;
    EXECUTE v_sql INTO v_count USING p_event_type, p_from, p_to;
    RETURN v_count;
  END IF;

  RETURN v_estimate;
END;
$$;

REVOKE ALL ON FUNCTION public.audit_log_count_fast(text, timestamptz, timestamptz) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.audit_log_count_fast(text, timestamptz, timestamptz) TO authenticated, service_role;

CREATE INDEX IF NOT EXISTS idx_audit_log_event_type_created_at
  ON public.audit_log (event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_log_created_at_desc
  ON public.audit_log (created_at DESC);

ANALYZE public.audit_log;