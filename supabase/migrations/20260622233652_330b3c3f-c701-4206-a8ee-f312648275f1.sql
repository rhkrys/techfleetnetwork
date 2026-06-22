INSERT INTO public.bdd_scenarios (feature_area, feature_area_number, scenario_id, title, gherkin, status, test_type, test_file) VALUES
('Auth Resilience', 42, 'AUTH-OAUTH-APEX-CANONICAL-003', 'Boot-time host canonicalization redirects apex to www', 'Feature: Apex host canonicalization at boot
  Scenario: Visiting techfleet.network redirects to www before React mounts
    Given a user opens https://techfleet.network/login?next=/dashboard#access_token=abc
    When main.tsx invokes enforceCanonicalHost before any other module
    Then [UI] no /login screen flashes on the apex host
    And [Code] decideCanonicalRedirect returns shouldRedirect=true with target https://www.techfleet.network/login?next=/dashboard#access_token=abc
    And [DB] this scenario exists in bdd_scenarios with status implemented', 'implemented', 'unit', 'src/test/lib/host-canonical.test.ts'),
('Auth Resilience', 42, 'AUTH-OAUTH-NO-RESTART-LOOP-001', 'GoogleSignInButton has no click-time canonical restart', 'Feature: No apex<->www OAuth restart loop
  Scenario: Clicking Google sign-in never calls window.location.replace
    Given a user is on https://www.techfleet.network/login
    When they click the Google sign-in button
    Then [UI] the OAuth popup opens immediately with no intermediate redirect
    And [Code] window.location.replace is never called from GoogleSignInButton and the source contains no needsCanonicalRestart or from=oauth-canonical references
    And [DB] this scenario exists in bdd_scenarios with status implemented', 'implemented', 'unit', 'src/test/components/google-sign-in.no-restart.test.tsx')
ON CONFLICT (scenario_id) DO UPDATE SET status='implemented', test_file=EXCLUDED.test_file, gherkin=EXCLUDED.gherkin, updated_at=now();