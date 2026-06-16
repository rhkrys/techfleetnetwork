INSERT INTO public.bdd_scenarios (feature_area, feature_area_number, scenario_id, title, gherkin, status, test_type, test_file)
VALUES
  ('Tab switch reload prevention', 53, 'NO-RELOAD-TAB-001',
   'Tab hide/show on /admin/activity-log never triggers a reload or redirect',
   $g$Feature: No auto-reload on tab return
  Scenario: Admin switches tabs and returns to /admin/activity-log
    Given an authenticated admin is viewing /admin/activity-log on page 3
      And the severity filter is set to "error"
      And the page is scrolled halfway down
    When the admin switches to another tab for 30 seconds
      And the admin returns to the Tech Fleet tab
    Then [UI] the page is still /admin/activity-log with the same DOM identity (no remount)
      And [UI] page index, filter selection, search text, and scroll position are unchanged
      And [DB] zero new audit_log rows are written with event_type in ('session_idle_timeout','authn_unauthorized','client_error')
      And [Code] deploy-watcher.__debug() shows no extra version check was triggered by the tab return
      And [Code] no window.location.(reload|replace|assign) was called during the focus event$g$,
   'implemented', 'unit', 'src/test/smoke/no-tab-switch-reload.test.ts'),

  ('Tab switch reload prevention', 53, 'NO-RELOAD-TAB-002',
   'MfaEnforcementGuard does not redirect on focus when AAL is satisfied',
   $g$Feature: MFA guard is tab-switch-safe
  Scenario: AAL2-elevated admin returns to a tab
    Given an authenticated admin with verified TOTP at AAL2
      And the admin is on /admin/activity-log
    When the admin returns to the tab after being hidden
    Then [UI] the route is still /admin/activity-log (no /login redirect)
      And [UI] no MFA challenge dialog opens
      And [DB] no mfa_challenge_initiated or mfa_challenge_failed audit row is written
      And [Code] MfaEnforcementGuard.tsx does NOT call addEventListener("focus", ...)
      And [Code] MfaEnforcementGuard.tsx does NOT call window.location.replace("/login") — it uses react-router navigate() instead
      And [Code] onAuthStateChange (SIGNED_IN | TOKEN_REFRESHED | USER_UPDATED) is the only re-evaluation channel$g$,
   'implemented', 'unit', 'src/test/smoke/no-tab-switch-reload.test.ts'),

  ('Activity Log state durability', 53, 'ACTIVITY-LOG-STATE-001',
   'Page, filters, search, and scroll survive a hard reload of /admin/activity-log',
   $g$Feature: Reload-safe Activity Log state
  Scenario: Admin reloads /admin/activity-log mid-investigation
    Given an authenticated admin is viewing /admin/activity-log
      And the admin has navigated to page 3
      And the severity filter is set to "error"
      And the search box contains "trace:abc123"
      And the page is scrolled to y=600
    When the admin performs a hard browser reload
    Then [UI] the page index, severity filter, and search text are exactly what they were pre-reload
      And [UI] the grid scroll position is within 50 px of y=600
      And [UI] no extra clicks are required from the admin
      And [DB] only the standard read queries fire (no writes)
      And [Code] ActivityLogPage hydrates from URL params first, then sessionStorage "tfn:activity-log:state", then defaults
      And [Code] ActivityLogPage does NOT use bare useState for page/search/eventFilter/layerFilter/severityFilter/dateFrom/dateTo$g$,
   'implemented', 'e2e', 'e2e/regression/incidents/activity-log-tab-switch.e2e.ts')
ON CONFLICT (scenario_id) DO UPDATE SET
  status = EXCLUDED.status,
  gherkin = EXCLUDED.gherkin,
  title = EXCLUDED.title,
  test_file = EXCLUDED.test_file,
  updated_at = now();