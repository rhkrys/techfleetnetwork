INSERT INTO public.bdd_scenarios (feature_area, feature_area_number, scenario_id, title, gherkin, status, test_type, test_file)
VALUES
  ('Dashboard Hydration', 42, 'DASHBOARD-HYDRATE-001',
   'Returning user sees last-known progress instantly on reload',
   'Feature: Dashboard hydrates from persisted snapshot
  Scenario: Returning user reloads the dashboard
    Given I am a signed-in member who has completed 3 of 5 onboarding courses
      And my last dashboard_overview RPC succeeded and was persisted to localStorage
    When I hard-reload "/"
    Then [UI] the Getting started checklist shows "3 of 5 complete" within 100ms of first paint
      And [UI] no "0 of 5 complete" copy is ever rendered during the load
      And [Code] persist-client restores snapshot before the first render
      And [DB] get_dashboard_overview() runs once via auth.uid() to revalidate in the background',
   'not_built', 'unit', 'src/test/lib/query-persister.test.ts'),
  ('Dashboard Hydration', 42, 'DASHBOARD-HYDRATE-002',
   'First-ever sign-in shows skeleton, never the brand-new-user flash',
   'Feature: Dashboard hydrates from persisted snapshot
  Scenario: First load with no snapshot in localStorage
    Given I am a brand-new signed-in member
      And no tfn:rq-cache:v1 entry exists in localStorage
    When I navigate to "/"
    Then [UI] the core_courses section renders a skeleton while overview/progress are pending
      And [UI] the "0 of 5 complete" text only appears after the RPC resolves with confirmed-zero progress
      And [Code] overviewReady stays false until every progress query has one successful result
      And [DB] get_dashboard_overview() and per-phase journey_progress reads succeed',
   'not_built', 'unit', 'src/test/lib/query-persister.test.ts'),
  ('Dashboard Hydration', 42, 'DASHBOARD-HYDRATE-003',
   'Signing out wipes the persisted snapshot so the next user cannot see it',
   'Feature: Dashboard hydrates from persisted snapshot
  Scenario: User A signs out, user B signs in on the same device
    Given user A signed in, loaded the dashboard, and a persisted snapshot exists in localStorage
    When user A signs out
      And user B signs in on the same device
    Then [UI] user B never sees user A''s checklist progress, badges, or applications
      And [Code] AuthContext SIGNED_OUT handler calls purgePersistedCache() and clears the queryClient
      And [DB] an audit_log row is written for the sign-out event',
   'not_built', 'unit', 'src/test/lib/query-persister.test.ts')
ON CONFLICT (scenario_id) DO UPDATE SET
  title = EXCLUDED.title, gherkin = EXCLUDED.gherkin,
  test_type = EXCLUDED.test_type, test_file = EXCLUDED.test_file, updated_at = now();