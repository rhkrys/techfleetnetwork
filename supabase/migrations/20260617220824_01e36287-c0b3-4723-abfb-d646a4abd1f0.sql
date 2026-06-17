INSERT INTO public.bdd_scenarios (scenario_id, feature_area, feature_area_number, title, gherkin, status, test_type, test_file, notes) VALUES
('AUTH-RESILIENCE-001','Authentication session resilience',1,'getSessionSafe never throws on transient backend errors',
'Given the backend auth read momentarily fails
When the app calls getSessionSafe
Then the call resolves to null without throwing
And the user remains on their current route',
'implemented','unit','src/test/regression/incidents/session-port-resilience.test.ts',
'[UI] User stays on current page; no /login redirect. [DB] No write to revoked_sessions / login_rate_limits. [Code] getSessionSafe returns null, no exception propagated, no purgeLocalAuthState invoked.'),
('AUTH-RESILIENCE-002','Authentication session resilience',1,'getUserSafe retries transient bad_jwt without signing user out',
'Given the stored access token is structurally valid and unexpired
And the auth backend returns bad_jwt on the first /user call
When the app calls getUserSafe
Then the port retries with jittered backoff
And the second call succeeds
And no sign-out is triggered',
'implemented','unit','src/test/regression/incidents/session-port-resilience.test.ts',
'[UI] No bounce to /login; protected route renders normally. [DB] No revoked_sessions row written. [Code] supabase.auth.getUser called twice; purgeLocalAuthState NOT invoked; auth_flap_detected beacon emitted with retries=1.'),
('AUTH-RESILIENCE-003','Authentication session resilience',1,'signOutSafe always purges local state even when backend errors',
'Given the auth backend signOut endpoint is unreachable
When the app calls signOutSafe with reason=profile_update
Then the call resolves without throwing
And local sb-*-auth-token storage is purged
And the cached session is invalidated',
'implemented','unit','src/test/regression/incidents/session-port-resilience.test.ts',
'[UI] User is signed out client-side and redirected per caller. [DB] No-op (backend never reached). [Code] purgeLocalAuthState called once with reason=manual; invalidateCachedSession called; no exception bubbles.'),
('AUTH-RESILIENCE-004','Authentication session resilience',1,'Session-mutating auth methods are banned outside the port',
'Given a developer writes supabase.auth.signOut() in a settings page
When ESLint runs in CI
Then auth-invariants/no-direct-auth-mutations reports an error
And the build fails',
'implemented','none','scripts/lint/eslint-plugin-auth-invariants.mjs',
'[UI] N/A build-time guard. [DB] N/A. [Code] eslint rule auth-invariants/no-direct-auth-mutations fires at severity=error for signOut/setSession/signInWithPassword/signInWithOAuth/refreshSession outside session-port / features/auth / AuthContext / GoogleSignInButton / generated integrations.'),
('AUTH-RESILIENCE-005','Authentication session resilience',1,'MFA refusal still uses safe sign-out',
'Given an admin within the MFA grace window cancels the MFA challenge
When MfaEnforcementGuard signs them out
Then signOutSafe is invoked with reason=mfa_refused
And local storage is purged even if the backend errors',
'implemented','manual','src/components/MfaEnforcementGuard.tsx',
'[UI] User redirected to /login; no flicker, no white screen. [DB] Optional revoked_sessions row only if backend reachable. [Code] signOutSafe called with {scope:global, reason:mfa_refused}; purgeLocalAuthState always invoked.'),
('AUTH-RESILIENCE-006','Authentication session resilience',1,'Telemetry beacon fires on transient flap recovery',
'Given getUserSafe recovers after one retry
When the successful call returns
Then a fire-and-forget beacon auth_flap_detected is posted to record-auth-wedge
And no PII or token bytes are included in the payload',
'implemented','manual','src/lib/auth/session-port.ts',
'[UI] Invisible to user. [DB] ops_events row {kind:auth_flap_detected, source:getUserSafe, retries:1, route:pathname}. [Code] sendBeacon (or keepalive fetch fallback) called once; no access_token / refresh_token / user_id in body.')
ON CONFLICT (scenario_id) DO UPDATE
  SET feature_area=EXCLUDED.feature_area, feature_area_number=EXCLUDED.feature_area_number,
      title=EXCLUDED.title, gherkin=EXCLUDED.gherkin, status=EXCLUDED.status,
      test_type=EXCLUDED.test_type, test_file=EXCLUDED.test_file, notes=EXCLUDED.notes;