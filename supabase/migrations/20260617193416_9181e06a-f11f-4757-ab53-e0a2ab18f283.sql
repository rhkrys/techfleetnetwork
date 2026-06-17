INSERT INTO bdd_scenarios (scenario_id, feature_area, feature_area_number, title, gherkin, status, test_file) VALUES
 ('AUTH-OAUTH-PENDING-001', 'auth-rebuild', 200,
  'OAuth callback-pending guard defers /login redirect during PKCE consumption',
  E'Feature: Gmail login never bounces back to the home page\n  Scenario: ProtectedRoute defers redirect while OAuth callback is being consumed\n    Given a member returns from Google with `/?code=…&state=…` in the URL\n    And AuthContext has not yet emitted SIGNED_IN\n    When ProtectedRoute renders\n    Then [Code] isOAuthCallbackPending() returns true\n    And [UI] the member sees a "Finishing sign-in…" spinner, NOT a /login redirect\n    And [DB] no audit_log row of kind "auth.bounced_to_login" is inserted',
  'implemented', 'src/test/regression/incidents/oauth-callback-pending-defers-redirect.test.ts'),
 ('AUTH-OAUTH-PENDING-002', 'auth-rebuild', 200,
  'GoogleSignInButton arms the pending guard before bouncing to Google',
  E'Scenario: Click arms guard\n  Given the member clicks "Continue with Google"\n  When GoogleSignInButton calls lovable.auth.signInWithOAuth\n  Then [Code] markOAuthCallbackPending() is invoked before the redirect\n  And [Code] beaconWedge("oauth_start","google_sign_in_button") is fired\n  And [DB] ops_events records reason="oauth_start" with no token/PII payload',
  'implemented', 'src/components/GoogleSignInButton.tsx'),
 ('AUTH-OAUTH-PENDING-003', 'auth-rebuild', 200,
  'AuthContext clears the pending guard on SIGNED_IN',
  E'Scenario: SIGNED_IN releases the spinner\n  Given the pending guard is armed\n  When AuthContext receives SIGNED_IN with a real session\n  Then [Code] clearOAuthCallbackPending() is invoked synchronously after URL cleanup\n  And [UI] ProtectedRoute renders the protected child instead of the spinner\n  And [DB] beaconWedge("oauth_callback_consumed","bootstrap_hash") is recorded when consumption took the hash path',
  'implemented', 'src/contexts/AuthContext.tsx'),
 ('AUTH-OAUTH-PENDING-004', 'auth-rebuild', 100,
  '12s watchdog prevents the spinner from freezing the app',
  E'Scenario: Watchdog trips on stuck consumer\n  Given markOAuthCallbackPending() was called 12+ seconds ago\n  And no SIGNED_IN has fired\n  When isOAuthCallbackPending() is called\n  Then [Code] it returns false and removes the sessionStorage key\n  And [Code] beaconWedge("oauth_callback_timeout","callback_pending_guard") fires once\n  And [UI] ProtectedRoute falls through to the normal /login redirect',
  'implemented', 'src/test/regression/incidents/oauth-callback-pending-defers-redirect.test.ts')
ON CONFLICT (scenario_id) DO UPDATE SET
  title = EXCLUDED.title, gherkin = EXCLUDED.gherkin, feature_area = EXCLUDED.feature_area,
  feature_area_number = EXCLUDED.feature_area_number,
  status = EXCLUDED.status, test_file = EXCLUDED.test_file;