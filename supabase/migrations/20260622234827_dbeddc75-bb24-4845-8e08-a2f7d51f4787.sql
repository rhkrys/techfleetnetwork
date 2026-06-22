INSERT INTO public.bdd_scenarios (scenario_id, feature_area, feature_area_number, title, gherkin, status, test_file)
VALUES (
  'AUTH-OAUTH-APEX-EDGE-301-001',
  'AUTH-CORE',
  1,
  'Apex techfleet.network 301s to www at the edge',
  $gh$Given a user navigates to https://techfleet.network/<path>
When the request reaches Lovable hosting
Then the response is HTTP 301
And [UI] the browser follows to https://www.techfleet.network/<path> preserving query and hash
And [Code] no client JS executes on the apex origin (enforceCanonicalHost is removed)
And [DB] no apex-origin auth tokens are written to localStorage$gh$,
  'implemented',
  'e2e/auth/apex-canonical-edge.e2e.ts'
)
ON CONFLICT (scenario_id) DO UPDATE
  SET gherkin = EXCLUDED.gherkin,
      status = EXCLUDED.status,
      test_file = EXCLUDED.test_file,
      updated_at = now();