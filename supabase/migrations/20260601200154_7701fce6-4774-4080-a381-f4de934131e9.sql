CREATE TABLE IF NOT EXISTS public.auth_wedge_events (
  id           BIGSERIAL PRIMARY KEY,
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  reason       TEXT NOT NULL,
  source       TEXT NOT NULL,
  user_agent   TEXT,
  ip_hash      TEXT,
  route        TEXT,
  release_tag  TEXT
);

GRANT SELECT ON public.auth_wedge_events TO authenticated;
GRANT ALL ON public.auth_wedge_events TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.auth_wedge_events_id_seq TO service_role;

ALTER TABLE public.auth_wedge_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read auth_wedge_events"
  ON public.auth_wedge_events FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS idx_auth_wedge_events_occurred_at
  ON public.auth_wedge_events (occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_wedge_events_reason_time
  ON public.auth_wedge_events (reason, occurred_at DESC);

INSERT INTO public.bdd_scenarios (feature_area, feature_area_number, scenario_id, title, gherkin, status, test_type)
VALUES
('Auth wedge recovery', 60000, 'AUTH-WEDGE-001','Malformed access token on bootstrap purges and signs out',
$$Scenario: Malformed access token on bootstrap
  Given the browser has a stored sb-*-auth-token whose access_token is not 3 segments
  When the AuthProvider mounts and calls getUser()
  Then [UI] the app renders the logged-out shell and redirects to /login
  And [DB] one row is appended to auth_wedge_events with reason='jwt_corrupt' source='bootstrap'
  And [Code] purgeLocalAuthState({reason:"jwt_corrupt"}) is invoked exactly once$$,
'not_built'::bdd_status,'unit'::bdd_test_type),
('Auth wedge recovery', 60000, 'AUTH-WEDGE-002','Live 403 bad_jwt triggers one-shot recovery',
$$Scenario: Live 403 bad_jwt mid-session
  Given an authenticated user whose access token was issued before a GoTrue key rotation
  When any Supabase REST/Auth call returns 403 with error_code "bad_jwt"
  Then [UI] the user is redirected to /login?reason=session_expired with a friendly toast
  And [DB] auth_wedge_events gets reason='jwt_corrupt' source='fetch_guard'
  And [Code] further /user calls in the next 5s are zero$$,
'not_built'::bdd_status,'e2e'::bdd_test_type),
('Auth wedge recovery', 60000, 'AUTH-WEDGE-003','Client fingerprint mismatch purges before getSession',
$$Scenario: Publishable key rotated
  Given localStorage has an auth_client_fingerprint from a previous publishable key
  When the app boots
  Then [UI] no spinner-lock occurs; login page is shown without round-trip
  And [DB] auth_wedge_events gets reason='fingerprint_mismatch' source='bootstrap'
  And [Code] purgeLocalAuthState runs before supabase.auth.getSession()$$,
'not_built'::bdd_status,'unit'::bdd_test_type),
('Auth wedge recovery', 60000, 'AUTH-WEDGE-004','setSession refuses non-JWT tokens',
$$Scenario: Pre-setSession shape check
  Given a sign-in response whose access_token is missing dot segments
  When AuthService writes the session
  Then [UI] the user sees the standard "invalid login" error
  And [DB] auth_wedge_events gets reason='shape_invalid' source='signin'
  And [Code] supabase.auth.setSession is never called with the malformed token$$,
'not_built'::bdd_status,'unit'::bdd_test_type),
('Auth wedge recovery', 60000, 'AUTH-WEDGE-005','classifyAuthError covers all observed JWT-corrupt messages',
$$Scenario: classifyAuthError coverage
  Given an error message includes any of: bad_jwt / invalid number of segments / token is malformed / parse or verify signature / refresh token revoked
  When classifyAuthError(err) is called
  Then [Code] the returned classification is jwt_corrupt or refresh_invalid, never ok$$,
'not_built'::bdd_status,'unit'::bdd_test_type),
('Auth wedge recovery', 60000, 'AUTH-WEDGE-006','Sign-in purges residual sb-* keys before writing',
$$Scenario: Storage hygiene on sign-in
  Given residual sb-*-auth-token entries from a previous session exist
  When the user completes a successful password or OAuth sign-in
  Then [Code] purgeLocalAuthState({keepCurrent:true}) runs before setSession
  And [UI] the user lands on /dashboard without a bad_jwt retry
  And [DB] no auth_wedge_events row is appended for the successful flow$$,
'not_built'::bdd_status,'e2e'::bdd_test_type),
('Auth wedge recovery', 60000, 'AUTH-WEDGE-007','Wedge spike surfaces in Triage',
$$Scenario: Spike detection
  Given more than 10 auth_wedge_events rows are inserted within 5 minutes
  When the Triage critical-push cron evaluates fingerprints
  Then [DB] an agent_fix_queue row with severity='error' and fingerprint like 'auth_wedge:%' is created
  And [UI] admins receive a single web-push within the hour-cap window$$,
'not_built'::bdd_status,'e2e'::bdd_test_type)
ON CONFLICT (scenario_id) DO NOTHING;