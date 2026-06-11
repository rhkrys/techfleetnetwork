INSERT INTO public.bdd_scenarios (feature_area, feature_area_number, scenario_id, title, gherkin) VALUES
  ('Auth Captcha Lifecycle', 21, 'AUTH-LOGIN-SESSION-001',
   'Accepted password only redirects after confirmed client session',
$gherkin$Feature: Login session confirmation
  Scenario: Backend accepts the password but browser session persistence fails
    Given a member is on /login with a valid email, valid password, and a fresh Turnstile token
    When the login-with-captcha function returns 200 with valid access and refresh tokens
    And the browser auth client cannot confirm a stored session after setSession
    Then [UI] the member stays on /login and does NOT navigate to /dashboard
    And  [UI] the Turnstile widget soft-resets immediately without a 30-second countdown
    And  [UI] no stale "complete the human verification below" trap is shown for the consumed token
    And  [DB] no invalid_credentials outcome is recorded for the attempt
    And  [DB] no login_attempt rate-limit bucket is incremented for the member
    And  [Code] setSessionSafe throws ClientSessionWriteError instead of returning the server-issued session body
    And  [Code] LoginPage handles client_session_write_failed through decideFailureActions with every counter flag false$gherkin$)
ON CONFLICT (scenario_id) DO UPDATE SET gherkin = EXCLUDED.gherkin, title = EXCLUDED.title;