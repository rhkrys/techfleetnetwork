UPDATE public.bdd_scenarios
SET gherkin = $gherkin$Feature: Login captcha lifecycle
  Scenario: A client_session_write_failed never enters the 30s retry lockout
    Given a member is on /login with a valid email and password typed in
    And the Turnstile widget has issued a single-use token
    When the member clicks "Sign in" and the browser fails to persist the new session
    Then [UI] the member stays on /login and sees a retry message without "didn't complete cleanly"
    And  [UI] the Turnstile widget remounts a fresh token immediately (no 30s countdown, no pointer-events-none overlay)
    And  [UI] the inline "complete human verification below" notice is NOT shown when the widget is interactive
    And  [DB] no row is appended to public.login_attempts with outcome='invalid_credentials' for this attempt
    And  [DB] public.rate_limit_buckets shows NO increment for this email's login_attempt bucket
    And  [Code] classifyAuthError() returns kind=CLIENT_SESSION_WRITE_FAILED with countsAgainstUser=false
    And  [Code] LoginPage bumps captchaSoftResetCount (non-punitive), NOT captchaFailureCount$gherkin$,
    title = 'Client session-write failure refreshes Turnstile without lockout'
WHERE scenario_id = 'AUTH-CAPTCHA-LIFECYCLE-002-A';