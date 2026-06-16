INSERT INTO public.bdd_scenarios (feature_area, feature_area_number, scenario_id, title, gherkin, status, test_type, test_file, notes)
VALUES
('auth', 1100, 'AUTH-WEDGE-013',
 'Bootstrap does not sign out user on first transient bad_jwt from GoTrue',
 $$Feature: Auth bootstrap survives transient GoTrue bad_jwt
  Scenario: Single transient bad_jwt during bootstrap keeps user signed in
    Given a user has a structurally valid, unexpired stored access token
    And GoTrue returns 403 bad_jwt for GET /user (transient hiccup)
    When AuthContext bootstrap validates the session
    Then [Code] no synchronous supabase.auth.refreshSession() call is made from the bootstrap self-heal block
    And [Code] decidePurgeOnBadJwt() returns shouldPurge=false (first strike)
    And [UI] the user remains signed in and is NOT redirected to the logged-out home page
    And [DB] an auth_wedge_events row is inserted with reason="transient_bad_jwt" source="bootstrap"$$,
 'implemented', 'unit', 'src/test/regression/incidents/auth-wedge-bootstrap-no-refresh-2026-06-16.test.ts',
 'Root-cause fix for 2026-06-16 incident.'),
('auth', 1100, 'AUTH-WEDGE-014',
 'Two transient bad_jwt within 15s still purges',
 $$Feature: Two-strike gate intact
  Scenario: Second bad_jwt within 15s triggers purge
    Given a user has a structurally valid, unexpired stored access token
    And GoTrue returned bad_jwt once within the last 15 seconds
    When a second bad_jwt arrives within the transient window
    Then [Code] decidePurgeOnBadJwt() returns shouldPurge=true reason="second_strike"
    And [Code] purgeLocalAuthState is called with reason="jwt_corrupt"
    And [UI] the user is signed out and lands on the logged-out home page$$,
 'implemented', 'unit', 'src/test/regression/incidents/auth-wedge-bootstrap-no-refresh-2026-06-16.test.ts',
 'Confirms two-strike protection still fires on genuine corruption.'),
('auth', 1100, 'AUTH-WEDGE-015',
 'Google OAuth + GoTrue /user 403 keeps user signed in',
 $$Feature: Google OAuth survives GoTrue /user flapping
  Scenario: OAuth callback succeeds, /user 403s once, user stays in
    Given the user just completed Google OAuth and consumeOAuthHashIfPresent set a fresh session
    And GoTrue returns 403 bad_jwt for the first GET /user validation
    When AuthContext bootstrap runs
    Then [Code] no refreshSession() is fired from the bootstrap block
    And [Code] beaconWedge("transient_bad_jwt","bootstrap") is invoked
    And [UI] the user lands on the post-login destination (not the logged-out home)
    And [DB] no purge audit row is written for this transient event$$,
 'implemented', 'unit', 'src/test/regression/incidents/auth-wedge-bootstrap-no-refresh-2026-06-16.test.ts',
 'Direct reproduction of the 2026-06-16 user-reported bounce.')
ON CONFLICT (scenario_id) DO UPDATE
SET title = EXCLUDED.title, gherkin = EXCLUDED.gherkin, status = EXCLUDED.status,
    test_type = EXCLUDED.test_type, test_file = EXCLUDED.test_file,
    notes = EXCLUDED.notes, updated_at = now();