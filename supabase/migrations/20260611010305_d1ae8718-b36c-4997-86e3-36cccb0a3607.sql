INSERT INTO public.bdd_scenarios (feature_area, feature_area_number, scenario_id, title, gherkin, status, test_type, test_file, notes)
VALUES (
  'Authentication',
  2,
  'AUTH-RESET-025',
  'Password reset finalize requires a live recovery session before calling the backend',
  'Feature: Password reset completion reliability
  Scenario: AUTH-RESET-025
    Given a member is on the password reset form after opening a reset link
    And their browser no longer has a live recovery session
    When they submit matching new password fields
    Then [UI] the member sees the expired-link recovery path and can request a new reset link
    And [DB] no warn-severity audit_log row is written for edge.finalize-password-reset reason=missing_token
    And [Code] AuthService.updatePassword stops before finalize-password-reset when no recovery access token exists
    And [Code] AuthService.updatePassword sends Authorization: Bearer <recovery_access_token> when the recovery session exists',
  'implemented',
  'unit',
  'src/test/services/auth.service.test.ts, supabase/functions/finalize-password-reset/index.ts, supabase/functions/_shared/request-auth.ts',
  'Root-cause guard for finalize-password-reset missing_token warnings caused by a consumed or cleared recovery JWT.'
)
ON CONFLICT (scenario_id) DO UPDATE SET
  feature_area = EXCLUDED.feature_area,
  feature_area_number = EXCLUDED.feature_area_number,
  title = EXCLUDED.title,
  gherkin = EXCLUDED.gherkin,
  status = EXCLUDED.status,
  test_type = EXCLUDED.test_type,
  test_file = EXCLUDED.test_file,
  notes = EXCLUDED.notes,
  updated_at = now();