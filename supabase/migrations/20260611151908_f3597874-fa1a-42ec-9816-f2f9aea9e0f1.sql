CREATE OR REPLACE FUNCTION public._login_outcome_allowed(o text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT o = ANY (ARRAY[
    'started','captcha_loaded','captcha_blocked','captcha_failed',
    'edge_entered','domain_reject','auth_throttle','invalid_credentials',
    'session_set','mfa_required','redirected','session_incomplete',
    'client_session_write_failed',
    'network_error','server_error','stale_chunk_recovery',
    'magic_link_sent','magic_link_failed','unknown'
  ]);
$function$;

INSERT INTO public.bdd_scenarios (feature_area, feature_area_number, scenario_id, title, gherkin, status, test_type, test_file, notes)
VALUES
  ('Authentication', 38, 'AUTH-DIRECT-SIGNIN-001', 'Password sign-in uses the auth SDK as the session owner', E'Given a member submits valid email, password, and human verification\nWhen the password sign-in flow runs\nThen [Code] the client calls the auth SDK password sign-in method directly with the captcha token\nAnd [Code] the active login form does not invoke login-with-captcha or re-hydrate raw edge-issued tokens\nAnd [UI] the member is navigated to the saved destination after the session is set\nAnd [DB] login_attempts records started, session_set, and redirected outcomes for the attempt', 'implemented', 'unit', 'src/test/services/auth.service.test.ts', 'Root-cause fix for Vichea login client_session_write_failed loop.'),
  ('Authentication', 38, 'AUTH-DIRECT-SIGNIN-002', 'Session-write failures stay non-punitive', E'Given the auth SDK accepts credentials but the browser session write fails\nWhen the sign-in engine classifies the failure as client_session_write_failed\nThen [Code] decideFailureActions returns incrementDeviceLockout=false, recordCredentialFailureRpc=false, and recordServerRateLimitFailure=false\nAnd [UI] the retry sign-in banner is shown with a fresh verification challenge\nAnd [DB] login_attempts records client_session_write_failed for the attempt without advancing rate_limits', 'implemented', 'unit', 'src/features/auth/services/__tests__/auth-failure-policy.contract.test.ts', 'Locks the non-punitive Vichea invariant.'),
  ('Authentication', 38, 'AUTH-DIRECT-SIGNIN-003', 'Active login form does not call login-with-captcha', E'Given the production source tree\nWhen the sign-in service is scanned\nThen [Code] AuthService.signInWithPassword contains zero calls to login-with-captcha\nAnd [Code] password sign-in has one active session owner: the auth SDK\nAnd [UI] the login form preserves the existing email, password, captcha, MFA, and redirect surfaces', 'implemented', 'unit', 'src/test/services/auth.service.test.ts', 'Retires the edge-token handoff from the active sign-in path.')
ON CONFLICT (scenario_id) DO UPDATE
SET feature_area = EXCLUDED.feature_area,
    feature_area_number = EXCLUDED.feature_area_number,
    title = EXCLUDED.title,
    gherkin = EXCLUDED.gherkin,
    status = EXCLUDED.status,
    test_type = EXCLUDED.test_type,
    test_file = EXCLUDED.test_file,
    notes = EXCLUDED.notes,
    updated_at = now();