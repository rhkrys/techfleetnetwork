
INSERT INTO public.bdd_scenarios (feature_area, feature_area_number, scenario_id, title, gherkin) VALUES
  ('Auth Captcha Lifecycle', 21, 'AUTH-CAPTCHA-LIFECYCLE-002-A',
   'Client session-write failure refreshes Turnstile without lockout',
$gherkin$Feature: Login captcha lifecycle
  Scenario: A client_session_write_failed never enters the 30s retry lockout
    Given a member is on /login with a valid email and password typed in
    And the Turnstile widget has issued a single-use token
    When the member clicks "Sign in" and the browser fails to persist the new session
    Then [UI] the red banner reads "We need to retry sign-in. Your account is safe..." (no "didn't complete cleanly")
    And  [UI] the Turnstile widget remounts a fresh token immediately (no 30s countdown, no pointer-events-none overlay)
    And  [UI] the inline "complete human verification below" notice is NOT shown when the widget is interactive
    And  [DB] no row is appended to public.login_attempts with outcome='invalid_credentials' for this attempt
    And  [DB] public.rate_limit_buckets shows NO increment for this email's login_attempt bucket
    And  [Code] classifyAuthError() returns kind=CLIENT_SESSION_WRITE_FAILED with countsAgainstUser=false
    And  [Code] LoginPage bumps captchaSoftResetCount (non-punitive), NOT captchaFailureCount$gherkin$),
  ('Auth Captcha Lifecycle', 21, 'AUTH-CAPTCHA-LIFECYCLE-002-B',
   'Invalid credentials still drive the punitive captcha+lockout path',
$gherkin$Feature: Login captcha lifecycle
  Scenario: A real INVALID_CREDENTIALS keeps the punitive path intact
    Given a member is on /login with the wrong password
    And the Turnstile widget has issued a single-use token
    When the member clicks "Sign in" and GoTrue returns invalid_credentials
    Then [UI] the red banner reads "That email and password didn't match..."
    And  [UI] the Turnstile widget refreshes via captchaFailureCount (punitive — after 2 strikes enters the 30s retry countdown)
    And  [DB] public.login_attempts records outcome='invalid_credentials'
    And  [DB] public.rate_limit_buckets increments for ('login_attempt', <email>)
    And  [Code] classifyAuthError() returns kind=INVALID_CREDENTIALS with countsAgainstUser=true$gherkin$),
  ('Auth Captcha Lifecycle', 21, 'AUTH-CAPTCHA-LIFECYCLE-002-C',
   'Password-reset success hands off a clean login state',
$gherkin$Feature: Login captcha lifecycle
  Scenario: After a successful password reset, login state has zero residual baggage
    Given a member completed /reset-password successfully
    When the member is redirected to /dashboard?from=password-reset
    Then [UI] /login (if revisited) renders the Turnstile widget eagerly — no idle-callback delay — so autofill can submit without hitting an empty-token guard
    And  [DB] public.rate_limit_buckets has the device + server login lockout cleared for this email (clear_login_rate_limit_for_email RPC)
    And  [Code] sessionStorage["tfn:reset-attempts"] is removed via clearAttempts()
    And  [Code] sessionStorage["tfn:login-captcha-state"] and "tfn:login-captcha-verified-until" are cleared via clearLoginCaptcha()
    And  [Code] sessionStorage["tfn_auth_transient_bad_jwt_first_ms"] is cleared via clearTransientStrike()
    And  [Code] the device auth-lockout key is cleared via clearAuthLockout()$gherkin$),
  ('Auth Captcha Lifecycle', 21, 'AUTH-CAPTCHA-LIFECYCLE-002-D',
   'Auth throttle (429) refreshes captcha non-punitively',
$gherkin$Feature: Login captcha lifecycle
  Scenario: A 429 auth-throttle does not consume a Turnstile failure strike
    Given a member is on /login
    When the sign-in call returns 429 with a captcha-throttle envelope
    Then [UI] the red banner shows the throttle message verbatim
    And  [UI] the Turnstile widget soft-resets a fresh token (no 30s countdown)
    And  [DB] no row is appended to public.login_attempts as invalid_credentials
    And  [Code] LoginPage bumps captchaSoftResetCount (non-punitive)
    And  [Code] classifyAuthError() returns kind=RATE_LIMITED with countsAgainstUser=false$gherkin$),
  ('Auth Captcha Lifecycle', 21, 'AUTH-CAPTCHA-LIFECYCLE-002-E',
   'Transient bad_jwt with healthy stored token does not sign the user out',
$gherkin$Feature: Auth wedge recovery (captcha-lifecycle adjacent invariant)
  Scenario: One bad_jwt during a GoTrue restart is not a purge event
    Given the locally stored sb-*-auth-token has valid shape and is unexpired
    When a single /user response returns 403 bad_jwt
    Then [UI] the member stays signed in; no redirect to /login
    And  [DB] no audit_log row is written with reason='jwt_corrupt'
    And  [Code] decidePurgeOnBadJwt() returns shouldPurge=false reason="transient"
    And  [Code] sessionStorage["tfn_auth_transient_bad_jwt_first_ms"] records the strike timestamp

  Scenario: Two bad_jwt within 15s purge (real corruption)
    Given the locally stored sb-*-auth-token has valid shape and is unexpired
    When two /user responses return 403 bad_jwt within 15 seconds
    Then [UI] the member is signed out and routed to /login?reason=session_expired
    And  [DB] one ops_events row is written with reason='second_strike'
    And  [Code] decidePurgeOnBadJwt() returns shouldPurge=true reason="second_strike"$gherkin$)
ON CONFLICT (scenario_id) DO UPDATE SET gherkin = EXCLUDED.gherkin, title = EXCLUDED.title;
