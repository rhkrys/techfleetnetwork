INSERT INTO public.bdd_scenarios (feature_area, feature_area_number, scenario_id, title, gherkin) VALUES
  ('Auth Captcha Lifecycle', 21, 'AUTH-RESET-LOGIN-COPY-002',
   'Password reset success hands off a clean login state',
$gherkin$Feature: Password reset to login handoff
  Scenario: After /reset-password success the member sees zero residual auth baggage
    Given a member just completed /reset-password successfully
    When the member is bounced to /login?from=password-reset (or the dashboard)
    Then [UI] no auth-lockout countdown is shown on /login
    And  [UI] the Turnstile widget mounts eagerly (no idle-callback delay) so autofill can submit cleanly
    And  [UI] no "complete human verification below" notice is shown when the widget is interactive
    And  [DB] public.rate_limit_buckets entries for this email's login_attempt bucket are cleared via clear_login_rate_limit_for_email RPC
    And  [Code] sessionStorage tfn:reset-attempts, tfn:login-captcha-state, tfn:login-captcha-verified-until, tfn_auth_transient_bad_jwt_first_ms, and the device auth-lockout key are all removed
    And  [Code] decideFailureActions("client_session_write_failed") still returns all counters=false (no regression to punitive path)$gherkin$),
  ('Auth Captcha Lifecycle', 21, 'AUTH-RESET-LOGIN-COPY-003',
   'Google-only account does not trigger a password-reset loop',
$gherkin$Feature: Google-only account recovery
  Scenario: A password attempt against a Google-only account suggests Google sign-in, not reset
    Given a member created an account via Google and never set a password
    When the member types email + any password on /login and submits with a fresh Turnstile token
    Then [UI] LoginPage shows the "This account uses Google sign-in" callout pointing at the Google button above
    And  [UI] the red "reset your password" recovery banner is NOT shown
    And  [UI] no auth-lockout countdown is started
    And  [DB] no row is appended to public.login_attempts for this attempt
    And  [DB] public.rate_limit_buckets shows no increment for this email's login_attempt bucket
    And  [Code] decideFailureActions("google_only_account") returns suggestReset=false and every counter flag=false$gherkin$)
ON CONFLICT (scenario_id) DO UPDATE SET
  title = EXCLUDED.title,
  gherkin = EXCLUDED.gherkin,
  feature_area = EXCLUDED.feature_area,
  feature_area_number = EXCLUDED.feature_area_number,
  updated_at = now();