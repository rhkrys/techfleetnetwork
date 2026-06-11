INSERT INTO public.bdd_scenarios (feature_area, feature_area_number, scenario_id, title, gherkin) VALUES
  ('Auth Captcha Lifecycle', 21, 'AUTH-RESET-LOGIN-COPY-001',
   'Login retry copy after client session-write failure is member-safe',
$gherkin$Feature: Login retry copy
  Scenario: client_session_write_failed shows member-safe recovery copy
    Given a member submitted /login with a valid email, password, and Turnstile token
    And the supabase client failed to persist the session locally
    When LoginPage renders the typed AuthErr banner
    Then [UI] the banner title reads "We need to retry sign-in"
    And  [UI] the body reads "Your account is safe. Something interrupted the browser session, so we cleared the attempt. Complete verification again and sign in."
    And  [UI] the recovery line points the member to Google sign-in or a sign-in link
    And  [UI] the legacy phrase "didn't complete cleanly" is NOT present anywhere on the page
    And  [DB] no row is appended to public.login_attempts for this attempt
    And  [DB] public.rate_limit_buckets shows no increment for the email's login_attempt bucket
    And  [Code] decideFailureActions("client_session_write_failed") returns incrementDeviceLockout=false, recordServerRateLimitFailure=false, recordCredentialFailureRpc=false
    And  [Code] LoginPage bumps captchaSoftResetCount and clears captchaToken so a fresh Turnstile token is issued$gherkin$),
  ('Auth Captcha Lifecycle', 21, 'AUTH-CAPTCHA-LIFECYCLE-002-F',
   'Turnstile blocked or repeatedly failing surfaces a fallback path',
$gherkin$Feature: Captcha blocked fallback
  Scenario: When Turnstile is blocked the member is offered Google + magic-link
    Given a member is on /login
    And Turnstile failed to load (extension, VPN, or strict privacy mode)
    When the member tries to sign in with email and password
    Then [UI] LoginPage shows an inline notice pointing at Google sign-in and the forgot-password recovery link
    And  [UI] the auth-lockout countdown is NOT started
    And  [DB] no row is appended to public.login_attempts
    And  [DB] public.rate_limit_buckets shows no increment for this email
    And  [Code] decideFailureActions("captcha_required") sets refreshCaptcha=true and every counter to false$gherkin$)
ON CONFLICT (scenario_id) DO UPDATE SET
  title = EXCLUDED.title,
  gherkin = EXCLUDED.gherkin,
  feature_area = EXCLUDED.feature_area,
  feature_area_number = EXCLUDED.feature_area_number,
  updated_at = now();