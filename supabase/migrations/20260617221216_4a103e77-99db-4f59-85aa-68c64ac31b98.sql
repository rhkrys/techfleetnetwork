CREATE OR REPLACE FUNCTION public.get_auth_resilience_counters(p_hours integer DEFAULT 24)
RETURNS TABLE (
  bucket_hour timestamptz,
  flaps bigint,
  signouts bigint,
  read_failures bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR auth.role() = 'service_role') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT
    date_trunc('hour', e.created_at) AS bucket_hour,
    count(*) FILTER (WHERE e.kind = 'auth_flap_detected')::bigint AS flaps,
    count(*) FILTER (WHERE e.kind = 'auth_signout')::bigint AS signouts,
    count(*) FILTER (WHERE e.kind = 'auth_read_failed')::bigint AS read_failures
  FROM public.ops_events e
  WHERE e.kind IN ('auth_flap_detected','auth_signout','auth_read_failed')
    AND e.created_at >= now() - make_interval(hours => greatest(p_hours, 1))
  GROUP BY 1
  ORDER BY 1 DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_auth_resilience_counters(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_auth_resilience_counters(integer) TO authenticated, service_role;