INSERT INTO public.bdd_scenarios (feature_area, feature_area_number, scenario_id, title, gherkin, status, test_type, test_file) VALUES
('Error Boundary', 58, 'UI-BOUNDARY-001',
 'Get Help route crash is isolated by ScopedErrorBoundary',
 'Feature: Scoped error boundaries
  Scenario: Get Help crash does not take down the app
    Given a member is on /community/get-help
    When the GetHelpPage throws during render (e.g. malformed FreeScout payload)
    Then [UI] the rest of the app shell stays mounted and the route shows "Get Help hit a snag" with a Try again button
    And [Code] console.error is called with [boundary:Get Help] and the original Error instance
    And [DB] one audit_log row is written with event_type=ui_render_error and source LIKE ''boundary.Get Help:%''',
 'implemented', 'unit', 'src/test/smoke/scoped-error-boundary.smoke.test.tsx'),
('Error Boundary', 58, 'UI-BOUNDARY-002',
 'AG Grid render crash is isolated by ScopedErrorBoundary',
 'Feature: Scoped error boundaries
  Scenario: Data grid crash does not take down the surrounding page
    Given an admin opens a page that mounts ThemedAgGrid
    When the grid render throws (e.g. malformed row data)
    Then [UI] the page chrome stays mounted and the grid area shows "Data grid hit a snag" with a Try again button
    And [UI] clicking Try again re-renders the grid when the underlying data is valid
    And [Code] console.error is called with [boundary:Data grid] and the original Error instance
    And [DB] one audit_log row is written with event_type=ui_render_error and source LIKE ''boundary.Data grid:%''',
 'implemented', 'unit', 'src/test/smoke/scoped-error-boundary.smoke.test.tsx')
ON CONFLICT (scenario_id) DO UPDATE SET
  title=EXCLUDED.title,
  gherkin=EXCLUDED.gherkin,
  status=EXCLUDED.status,
  test_type=EXCLUDED.test_type,
  test_file=EXCLUDED.test_file;