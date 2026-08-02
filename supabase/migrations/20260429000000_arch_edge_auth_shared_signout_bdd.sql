INSERT INTO public.bdd_scenarios (scenario_id, feature_area, feature_area_number, title, gherkin, status, test_type, test_file, notes)
VALUES (
  'ARCH-EDGE-SHARED-AUTH-002',
  'Architecture',
  99,
  'Authenticated edge functions use shared request infrastructure',
  'Feature: Edge function architecture\n  Scenario: A user revokes all active sessions\n    Given an authenticated user calls the sign-out-all-devices backend function\n    When the function validates the request\n    Then it uses the shared authentication helper\n    And it returns standardized CORS and JSON error responses\n    And it performs the same global session revocation behavior',
  'implemented',
  'smoke',
  'supabase/functions/sign-out-all-devices/index.ts',
  'Locks in the shared auth/http refactor for the session revocation backend function without changing user-facing behavior.'
)
ON CONFLICT (scenario_id) DO UPDATE SET
  title = EXCLUDED.title,
  gherkin = EXCLUDED.gherkin,
  status = EXCLUDED.status,
  test_type = EXCLUDED.test_type,
  test_file = EXCLUDED.test_file,
  notes = EXCLUDED.notes,
  updated_at = now();
