INSERT INTO public.bdd_scenarios (scenario_id, feature_area, feature_area_number, title, gherkin, status, test_type, test_file, notes)
VALUES (
  'ARCH-SERVICE-RESULT-001',
  'Architecture',
  99,
  'Frontend services use centralized safe error handling',
  'Feature: Service architecture\n  Scenario: A data service receives a backend error\n    Given a frontend service calls the backend\n    When the backend returns a structured error\n    Then the service logs normalized metadata\n    And the user-facing error message does not expose backend internals',
  'implemented',
  'unit',
  'src/test/lib/service-result.test.ts',
  'Covers the shared service-result helper used to keep service error handling scalable and secure.'
)
ON CONFLICT (scenario_id) DO UPDATE SET
  title = EXCLUDED.title,
  gherkin = EXCLUDED.gherkin,
  status = EXCLUDED.status,
  test_type = EXCLUDED.test_type,
  test_file = EXCLUDED.test_file,
  notes = EXCLUDED.notes,
  updated_at = now();
