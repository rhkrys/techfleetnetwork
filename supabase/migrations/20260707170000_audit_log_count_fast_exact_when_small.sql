-- Fix: audit_log_count_fast reported a misleadingly low total (~100) on the
-- UNFILTERED Activity Log view. The original unfiltered branch returned the
-- planner's pg_class.reltuples estimate directly, with no exact-count fallback.
-- Right after the bulk data migration, reltuples was stale-low (~100) until
-- autovacuum re-analyzed, so admins saw "~100 records" even though the table
-- held thousands (2,569 in the 2026-06-15..07-07 window).
--
-- Root layer: database (a count RPC), not the React page. The page correctly
-- calls the RPC; the RPC's unfiltered branch was the defect.
--
-- Fix: mirror the FILTERED path's behavior — when the table is small enough
-- that count(*) is cheap (<= 50000 rows), return an EXACT count; only fall back
-- to the fast estimate above that threshold (so it stays O(1) at scale). Also
-- ANALYZE once to refresh the estimate immediately. Idempotent (CREATE OR
-- REPLACE); admin-only + grants preserved exactly as the original.

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

  -- Unfiltered: estimate first (cheap), but return an EXACT count while the
  -- table is small. This is the fix — the previous version returned the stale
  -- estimate unconditionally here.
  IF p_event_type IS NULL AND p_from IS NULL AND p_to IS NULL THEN
    SELECT GREATEST(reltuples, 0)::bigint INTO v_estimate
    FROM pg_class
    WHERE oid = 'public.audit_log'::regclass;

    IF COALESCE(v_estimate, 0) <= 50000 THEN
      SELECT count(*) INTO v_count FROM public.audit_log;
      RETURN v_count;
    END IF;

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

-- Refresh the planner estimate now so even the >50k fast-path is accurate going forward.
ANALYZE public.audit_log;
