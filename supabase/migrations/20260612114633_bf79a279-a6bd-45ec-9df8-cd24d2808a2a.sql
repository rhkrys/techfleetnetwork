CREATE OR REPLACE FUNCTION public.admin_recent_login_attempts(
  p_email text,
  p_hours integer DEFAULT 24,
  p_max_rows integer DEFAULT 200
)
RETURNS TABLE (
  created_at timestamptz,
  attempt_id uuid,
  outcome text,
  branch text,
  http_status integer,
  duration_ms integer,
  origin_host text,
  user_agent_short text,
  user_id uuid
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
#variable_conflict use_column
DECLARE
  v_caller uuid := auth.uid();
  v_is_admin boolean := false;
  v_hours integer := GREATEST(1, LEAST(COALESCE(p_hours, 24), 24 * 14));
  v_limit integer := GREATEST(1, LEAST(COALESCE(p_max_rows, 200), 1000));
BEGIN
  IF p_email IS NULL OR length(trim(p_email)) = 0 THEN
    RAISE EXCEPTION 'email is required';
  END IF;

  IF v_caller IS NOT NULL THEN
    v_is_admin := public.has_role(v_caller, 'admin'::public.app_role);
  END IF;

  IF v_caller IS NOT NULL AND NOT v_is_admin THEN
    RAISE EXCEPTION 'admin role required';
  END IF;

  RETURN QUERY
  SELECT
    la.created_at,
    la.attempt_id,
    la.outcome,
    la.branch,
    la.http_status,
    la.duration_ms,
    la.origin_host,
    la.user_agent_short,
    la.user_id
  FROM public.login_attempts AS la
  WHERE la.email_hash = public._login_hash(p_email)
    AND la.created_at > now() - make_interval(hours => v_hours)
  ORDER BY la.created_at DESC
  LIMIT v_limit;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_recent_login_attempts(text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_recent_login_attempts(text, integer, integer) TO authenticated, service_role;

INSERT INTO public.bdd_scenarios (feature_area, feature_area_number, scenario_id, title, gherkin, status, test_type, test_file, notes)
VALUES
  ('Authentication', 38, 'AUTH-DIRECT-SIGNIN-004',
   'Sign-in service is the only password sign-in owner',
   E'Given the production source tree\nWhen the auth direct-signin guard scans the active /login chain\nThen [Code] AuthService.signInWithPassword no longer exists on the AuthService export\nAnd [Code] only src/features/auth/services/sign-in.service.ts calls the auth SDK password method through the supabase-session adapter\nAnd [Code] SignInScreen, useSignInEngine, sign-in-password.flow, and sign-in.service contain zero references to login-with-captcha, setSession, setSessionSafe, or AuthService.signInWithPassword\nAnd [UI] the /login form still renders email, password, captcha, MFA, and redirect controls unchanged\nAnd [DB] login_attempts continues to record started, session_set, and redirected outcomes for the attempt',
   'implemented', 'unit',
   'src/features/auth/services/__tests__/sign-in.service.test.ts, scripts/ci/check-auth-direct-signin.mjs',
   'Permanent removal of the edge-token handoff and AuthService.signInWithPassword.'),
  ('Authentication', 38, 'AUTH-DIRECT-SIGNIN-005',
   'Admins can inspect recent login trail for an email',
   E'Given an admin needs to verify a specific member''s login trail\nWhen the admin calls public.admin_recent_login_attempts(email, hours, max_rows)\nThen [Code] the function is SECURITY DEFINER, hashes the email server-side via _login_hash, and never exposes the hash function to clients\nAnd [DB] only admins (has_role admin) and service_role may execute the function; anon and signed-in non-admins are rejected\nAnd [UI] no member-facing surface changes — the diagnostic is admin-only and not surfaced in the app',
   'implemented', 'unit',
   'supabase/migrations (admin_recent_login_attempts), scripts/ci/check-auth-direct-signin.mjs',
   'Replaces the unsafe ad-hoc trail query that needed _login_hash from the client.')
ON CONFLICT (scenario_id) DO UPDATE
SET title = EXCLUDED.title,
    gherkin = EXCLUDED.gherkin,
    status = EXCLUDED.status,
    test_type = EXCLUDED.test_type,
    test_file = EXCLUDED.test_file,
    notes = EXCLUDED.notes;
