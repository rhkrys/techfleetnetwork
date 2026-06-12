INSERT INTO public.bdd_scenarios (feature_area, feature_area_number, scenario_id, title, gherkin, status, test_type, test_file, notes)
SELECT
  'journey-identity',
  COALESCE((SELECT MAX(feature_area_number) FROM public.bdd_scenarios WHERE feature_area = 'journey-identity'), 0) + 1,
  'JOURNEY-IDENTITY-004',
  'Legacy Curriculum route opens the Courses progress surface',
  $gherkin$
Feature: Journey progress identity

Scenario: Legacy Curriculum link shows completed courses for a signed-in member
  Given a signed-in member has completed journey progress rows and course completion rows
  When the member opens /curriculum
  Then [UI] the app renders the same Courses progress surface as /courses instead of a 404 page
  And [UI] completed course cards keep their completed task counts and Complete badges after auth hydration
  And [DB] no journey_progress, course_completions, badges_awarded, auth, profile, role, or certification rows are created, changed, or deleted by route aliasing
  And [Code] /curriculum is owned by the same protected TrainingPage route as /courses and progress reads continue to use the session user id
$gherkin$,
  'implemented'::bdd_status,
  'manual'::bdd_test_type,
  'src/App.tsx',
  'Added with the /curriculum route alias after confirming /curriculum returned 404 while /courses is the live training surface.'
WHERE NOT EXISTS (
  SELECT 1 FROM public.bdd_scenarios WHERE scenario_id = 'JOURNEY-IDENTITY-004'
);