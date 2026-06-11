INSERT INTO public.bdd_scenarios (feature_area, feature_area_number, scenario_id, title, gherkin, status, test_type, test_file, notes)
VALUES (
  'Authentication',
  2,
  'AUTH-RESET-024',
  'Recovery password update uses direct authenticated user endpoint',
  'Feature: Password reset completion reliability
  Scenario: AUTH-RESET-024
    Given a member has a valid recovery session after opening a reset link
    When they submit matching new password fields
    Then [UI] the success state is shown and the member can sign in with the new password
    And [DB] a revoked_sessions row is written with reason="self_password_changed" for older sessions only
    And [Code] finalize-password-reset updates /auth/v1/user with the recovery JWT instead of relying on edge-local SDK session storage',
  'implemented',
  'unit',
  'src/test/services/auth.service.test.ts, src/test/ui/ResetPasswordPage.test.tsx',
  'Root-cause guard for password reset failures that surfaced as password-service unavailable.'
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