-- Clears the login-attempt rate-limit bucket for a given email.
-- Called by the update-password-confirmed edge function on a successful
-- password update so the user is never locked out of /login by stale
-- failures recorded before they completed recovery.
--
-- The identifier MUST match the hashing scheme used by
-- src/services/rate-limit.service.ts:hashIdentifier (SHA-256 of
-- lower(email) || "::tfn-rate-limit-v1"). The pepper is intentionally
-- not secret — it is bundled into the client.

CREATE OR REPLACE FUNCTION public.clear_login_rate_limit_for_email(p_email text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_norm text;
  v_hash text;
BEGIN
  IF p_email IS NULL OR length(trim(p_email)) = 0 THEN
    RETURN;
  END IF;

  v_norm := lower(trim(p_email));
  v_hash := encode(digest(v_norm || '::tfn-rate-limit-v1', 'sha256'), 'hex');

  DELETE FROM public.rate_limits
   WHERE identifier = v_hash
     AND action = 'login_attempt';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.clear_login_rate_limit_for_email(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clear_login_rate_limit_for_email(text) TO service_role;