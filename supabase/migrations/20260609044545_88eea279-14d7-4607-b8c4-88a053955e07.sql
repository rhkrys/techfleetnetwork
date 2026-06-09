CREATE TABLE IF NOT EXISTS public.auth_prober_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  correlation_id uuid NOT NULL,
  stage text NOT NULL,
  outcome text NOT NULL,
  error_code text,
  latency_ms integer NOT NULL,
  prober_user_agent text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT ON public.auth_prober_results TO authenticated;
GRANT ALL    ON public.auth_prober_results TO service_role;

ALTER TABLE public.auth_prober_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read prober results"
  ON public.auth_prober_results FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Service role writes prober results"
  ON public.auth_prober_results FOR INSERT TO service_role
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_auth_prober_results_created_at
  ON public.auth_prober_results (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_prober_results_stage_outcome
  ON public.auth_prober_results (stage, outcome, created_at DESC);

-- AUTH-CORE BDD scenarios (30) — status enum is {implemented, partial, not_built}
INSERT INTO public.bdd_scenarios
  (feature_area, feature_area_number, scenario_id, title, gherkin, status, test_type)
VALUES
('AUTH-CORE', 1, 'AUTH-CORE-001', 'Valid password sign-in succeeds',
 'Given a confirmed member with a known password
When they submit valid credentials through SignInForm
Then [UI] the auth machine transitions idle → submitting → setting_session → signed_in
And [DB] one ops_events row exists with kind="auth.signin.success" and the form''s correlation_id
And [Code] AuthFailurePolicy.applyAfter is NOT invoked', 'implemented', 'unit'),

('AUTH-CORE', 1, 'AUTH-CORE-002', 'Wrong password is the only path that increments counters',
 'Given a member submitting a wrong password
When auth-broker/sign-in/password returns code="invalid_credentials"
Then [UI] AuthErrorMessage renders the empathetic "We couldn''t sign you in" copy
And [DB] failed_login_attempts gains exactly one row for the email hash
And [Code] AuthFailurePolicy returns recordCredentialFailureRpc=true, incrementDeviceLockout=true', 'implemented', 'unit'),

('AUTH-CORE', 1, 'AUTH-CORE-003', 'Client session-write failure is non-punitive (Vichea fix)',
 'Given the broker returned a valid session and the client setSession rejects
When the flow surfaces code="client_session_write_failed"
Then [UI] the form stays in "failed" with a "try again" CTA, NOT a lockout message
And [DB] no failed_login_attempts row is created and no rate_limits row advances
And [Code] AuthFailurePolicy returns all four flags as false; only a beacon fires', 'implemented', 'unit'),

('AUTH-CORE', 1, 'AUTH-CORE-004', 'Opaque refresh token is accepted by setSessionSafe',
 'Given GoTrue returns a non-JWT opaque refresh_token string
When auth-flow.service.setSessionSafe is called with that session
Then [UI] the machine reaches signed_in without surfacing an error
And [DB] no auth_wedge_events row is inserted
And [Code] isNonEmptyOpaqueToken(refresh_token) returns true and isLikelyJwt is NOT called', 'implemented', 'unit'),

('AUTH-CORE', 1, 'AUTH-CORE-005', 'Recovery session expired surfaces typed error',
 'Given the user opens a recovery link whose session has expired
When the consume-recovery-link flow runs
Then [UI] AuthErrorMessage renders the "request a new link" copy
And [DB] no profile row is mutated
And [Code] flow returns AuthErr with code="recovery_session_expired"', 'partial', 'unit'),

('AUTH-CORE', 1, 'AUTH-CORE-006', 'Recovery link consumed twice replays idempotently',
 'Given a recovery link was already used once
When complete-password-reset.flow runs again with the same token
Then [UI] the form shows the "this link was already used" copy
And [DB] request_idempotency replays the original 2xx body with X-Idempotent-Replay:1
And [Code] flow returns AuthErr with code="recovery_link_consumed"', 'not_built', 'none'),

('AUTH-CORE', 1, 'AUTH-CORE-007', 'Google sign-in returns redirecting_to_provider',
 'Given a member clicks "Continue with Google"
When sign-in-google.flow runs successfully
Then [UI] GoogleSignInButton enters busy state and stays there until redirect
And [DB] one ops_events row exists with kind="auth.signin.google.redirect"
And [Code] flow returns AuthOk with kind="redirecting_to_provider"', 'implemented', 'unit'),

('AUTH-CORE', 1, 'AUTH-CORE-008', 'Google-only account trying password gets typed code',
 'Given an account that only has a Google identity attempts password sign-in
When the broker detects no password identity
Then [UI] AuthErrorMessage renders the "sign in with Google" copy
And [DB] failed_login_attempts is NOT advanced
And [Code] flow returns AuthErr with code="google_only_account"', 'not_built', 'none'),

('AUTH-CORE', 1, 'AUTH-CORE-009', 'Reset → sign-out → sign-in with new password (Vichea journey)',
 'Given a member completes a password reset
When they sign out and sign back in with the new password
Then [UI] every transition completes without surfacing an error
And [DB] revoked_sessions rows from before the reset do not block the new session
And [Code] auth-prober records stage="reset_complete" outcome="ok" within 5 minutes', 'not_built', 'e2e'),

('AUTH-CORE', 1, 'AUTH-CORE-010', 'Password manager autofill is honored',
 'Given the user has Chrome or Safari autofill enabled
When SignInForm renders
Then [UI] inputs carry name="username", name="current-password", autoComplete locked
And [DB] N/A
And [Code] check-credential-attrs.mjs CI script asserts the attribute set', 'partial', 'none'),

('AUTH-CORE', 1, 'AUTH-CORE-011', 'Device lockout fires only on server invalid_credentials',
 'Given the broker returns network_error, service_unavailable, or unexpected
When AuthFailurePolicy.applyAfter runs
Then [UI] the form does NOT show a lockout banner
And [DB] failed_login_attempts is unchanged
And [Code] policy returns incrementDeviceLockout=false for all three branches', 'implemented', 'unit'),

('AUTH-CORE', 1, 'AUTH-CORE-012', 'CAPTCHA refresh only fires on captcha_failed',
 'Given the broker returns code="captcha_failed"
When AuthFailurePolicy.applyAfter runs
Then [UI] the Turnstile widget is re-rendered
And [DB] no credential counter advances
And [Code] policy returns refreshCaptcha=true and all other flags false', 'implemented', 'unit'),

('AUTH-CORE', 1, 'AUTH-CORE-013', 'MFA required transitions the machine',
 'Given the broker returns code="mfa_required" with a challenge id
When the SignInForm receives SERVER_ERR
Then [UI] the machine enters awaiting_mfa and MfaChallengeDialog opens
And [DB] one ops_events row exists with kind="auth.signin.mfa_required"
And [Code] state.context.mfaChallengeId equals the broker-issued id', 'not_built', 'unit'),

('AUTH-CORE', 1, 'AUTH-CORE-014', 'MFA wrong code does not advance credential counters',
 'Given the user submits a wrong TOTP code
When the broker returns code="mfa_invalid_code"
Then [UI] MfaChallengeDialog re-renders with the typed error and the field cleared
And [DB] failed_login_attempts is unchanged
And [Code] policy returns only the MFA-specific counter flag', 'not_built', 'unit'),

('AUTH-CORE', 1, 'AUTH-CORE-015', 'MFA cancel signs the user out',
 'Given the user is in awaiting_mfa
When they click "Cancel and sign out"
Then [UI] the machine receives RESET and routes back to /login
And [DB] one revoked_sessions row is inserted before any GoTrue call
And [Code] sign-out.flow runs before navigation', 'not_built', 'e2e'),

('AUTH-CORE', 1, 'AUTH-CORE-016', 'Transient bad_jwt survives the bootstrap',
 'Given a single bad_jwt strike during GoTrue restart
When decidePurgeOnBadJwt evaluates
Then [UI] the active session is NOT signed out
And [DB] one auth_wedge_events row is logged with reason="transient_bad_jwt"
And [Code] refreshSession() is retried once before any purge', 'implemented', 'unit'),

('AUTH-CORE', 1, 'AUTH-CORE-017', 'OAuth redirect preserves redirectTo',
 'Given the user lands on /login?redirectTo=/journey
When they click Google sign-in
Then [UI] the OAuth callback returns them to /journey
And [DB] no profile field changes
And [Code] sign-in-google.flow forwards the redirectTo input verbatim', 'not_built', 'e2e'),

('AUTH-CORE', 1, 'AUTH-CORE-018', 'Sign-out clears every auth storage key',
 'Given a signed-in member
When sign-out.flow completes
Then [UI] subsequent reload routes to /login
And [DB] one revoked_sessions row exists for the device
And [Code] auth-storage.service.purgeOnSignOut clears every key declared in auth-storage-keys.ts', 'partial', 'unit'),

('AUTH-CORE', 1, 'AUTH-CORE-019', 'Profile autosave never sets profile_completed',
 'Given a profile draft is autosaving
When autosaveDraft runs
Then [UI] no completion banner is shown
And [DB] profiles.profile_completed remains false
And [Code] the autosave payload type is Omit<ProfileFields, "profile_completed">', 'not_built', 'unit'),

('AUTH-CORE', 1, 'AUTH-CORE-020', 'Profile complete sets the flag exactly once',
 'Given a profile draft passes server validation
When profile-setup.service.complete runs
Then [UI] the user is routed to /journey
And [DB] profiles.profile_completed is true and journey_progress contains one onboarding row
And [Code] Discord notify + journey upsert run in Promise.allSettled', 'not_built', 'unit'),

('AUTH-CORE', 1, 'AUTH-CORE-021', 'Idle timeout fires at 30 minutes',
 'Given a signed-in tab with no input for 30 minutes
When auth-session.service evaluates idleness
Then [UI] the session is ended and a "you were signed out for inactivity" banner shows
And [DB] one revoked_sessions row exists with reason="idle_timeout"
And [Code] timer is cleared on unmount and re-created on focus', 'not_built', 'unit'),

('AUTH-CORE', 1, 'AUTH-CORE-022', 'Max-age fires at 4 hours',
 'Given a session older than 4 hours
When auth-session.service evaluates max age
Then [UI] the member is routed to /login with ?from=max_age
And [DB] one revoked_sessions row exists with reason="max_age"
And [Code] auth.refreshSession is NOT called after expiry', 'not_built', 'unit'),

('AUTH-CORE', 1, 'AUTH-CORE-023', 'Revoked session terminates within one tick',
 'Given a SessionGuard subscription is active
When a revoked_sessions row is inserted for the current device
Then [UI] the member is routed to /login within the next animation frame
And [DB] the revocation row is unchanged (no client mutation)
And [Code] the SessionGuard listener fires exactly once', 'implemented', 'unit'),

('AUTH-CORE', 1, 'AUTH-CORE-024', 'Broker rate limit returns retry-after',
 'Given the per-IP quota for sign-in/password is exhausted
When the next request hits auth-broker
Then [UI] the form shows the countdown returned in retryAfter
And [DB] rate_limits rows for the IP advance
And [Code] flow returns AuthErr with code="rate_limited" and retryAfter set', 'not_built', 'e2e'),

('AUTH-CORE', 1, 'AUTH-CORE-025', 'Suspicious-activity revocation is server-issued only',
 'Given a client-side error in setSession
When the failure policy classifies the event
Then [UI] no "suspicious activity" copy is rendered
And [DB] no revoked_sessions row with reason="auto_suspicious_activity" is inserted
And [Code] only the broker may insert that reason', 'partial', 'unit'),

('AUTH-CORE', 1, 'AUTH-CORE-026', 'Every state transition writes one ops_events row',
 'Given any auth flow runs end-to-end
When the machine transitions through its states
Then [UI] the form''s data-machine-state attribute matches the latest state.value
And [DB] one ops_events row exists per transition with the same correlation_id
And [Code] emitAuthBeacon is the only writer (audited by ESLint)', 'not_built', 'unit'),

('AUTH-CORE', 1, 'AUTH-CORE-027', 'Synthetic prober pages on two consecutive failures',
 'Given the auth-prober has just recorded two err rows for the same stage
When the prober finishes its third run
Then [UI] Triage Critical Push notifies admins
And [DB] auth_prober_results contains the three rows with the same prober_user_agent
And [Code] policy excludes the prober user agent from user-facing counters', 'not_built', 'none'),

('AUTH-CORE', 1, 'AUTH-CORE-028', 'Auth Funnel tab is admin-only',
 'Given an authenticated non-admin user
When they navigate to /admin/system-health
Then [UI] the Auth Funnel tab is NOT rendered
And [DB] the read RPC returns no rows for non-admins
And [Code] the tab component is guarded by has_role(auth.uid(), ''admin'')', 'not_built', 'none'),

('AUTH-CORE', 1, 'AUTH-CORE-029', 'AuthErrorCode union is exhaustive at the type level',
 'Given a new AuthErrorCode is added to the union
When any consumer switch(err.code) does not handle it
Then [UI] N/A
And [DB] N/A
And [Code] tsc fails at the assertNever call, blocking the PR', 'implemented', 'unit'),

('AUTH-CORE', 1, 'AUTH-CORE-030', 'No file outside src/features/auth/** calls supabase.auth.*',
 'Given the ESLint suite runs on a PR
When any file outside src/features/auth/** or the auto-generated client imports supabase.auth
Then [UI] N/A
And [DB] N/A
And [Code] auth-invariants/no-direct-supabase-auth reports a lint error', 'partial', 'none')
ON CONFLICT (scenario_id) DO NOTHING;
