CREATE OR REPLACE FUNCTION public.clear_own_auth_rate_limits_after_password_reset()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_email text;
  v_hash text;
BEGIN
  v_email := lower(trim(coalesce(auth.jwt() ->> 'email', '')));

  IF auth.uid() IS NULL OR v_email = '' THEN
    RETURN;
  END IF;

  v_hash := encode(digest(v_email || '::tfn-rate-limit-v1', 'sha256'), 'hex');

  DELETE FROM public.rate_limits
   WHERE identifier = v_hash
     AND action IN ('login_attempt', 'password_reset');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.clear_own_auth_rate_limits_after_password_reset() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clear_own_auth_rate_limits_after_password_reset() TO authenticated, service_role;

DELETE FROM public.rate_limits
WHERE action = 'password_reset'
  AND blocked_until IS NOT NULL
  AND blocked_until > now();