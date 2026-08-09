-- BDD scenarios for audit Wave 1 role-confirmation hardening (H12/H13/T-G).
BEGIN;

INSERT INTO public.bdd_scenarios
  (scenario_id, feature_area, feature_area_number, title, gherkin, status, test_type, test_file, notes)
VALUES
  ('CONFIRM-ROLE-TG-001', 'Access control', 62,
   'Role-confirmation links cannot be auto-triggered by an email prefetch',
   'Feature: prefetch-safe role confirmation\n  Scenario: an email prefetch (SafeLinks/AV) opens the link\n    Given an admin/teacher invitation email whose link points at /confirm-{admin,teacher}\n    When a prefetcher issues a bare GET with no session\n    Then no role is granted (the page never confirms on load)\n  Scenario: the invited user confirms\n    Given the invited user is signed in as themselves\n    When they click Confirm (a POST carrying their bearer JWT)\n    Then the edge function verifies caller.uid = promotion.user_id and grants the role\n  Scenario: a signed-in non-owner opens the link\n    Then the edge function returns 403 not_owner and grants nothing',
   'implemented', 'unit',
   'supabase/functions/_shared/confirm-role.test.ts',
   'T-G: GET->POST + caller-JWT ownership proof. Decision logic unit-tested; wiring covered by confirm-role-tokens.smoke.test.ts.'),

  ('CONFIRM-ROLE-H12-001', 'Access control', 62,
   'Promotion tokens expire and are single-use',
   'Feature: expiring single-use promotion tokens\n  Scenario: an expired link is rejected\n    Given a promotion whose expires_at is in the past\n    When the invited user tries to confirm\n    Then the edge function returns 410 expired and grants nothing\n  Scenario: a token is consumed once\n    Given an unconfirmed promotion\n    When two confirmations race\n    Then only the first consumes the token (atomic confirmed_at claim); the role is granted once',
   'implemented', 'unit',
   'supabase/tests/confirm_role_tokens_test.sql',
   'H12: expires_at (7d default) on admin_promotions + teacher_promotions; verifiers return expires_at; single-use via UPDATE ... WHERE confirmed_at IS NULL.'),

  ('CONFIRM-ROLE-H13-001', 'Access control', 62,
   'Teacher promotion tokens are hashed at rest (mirror of the admin path)',
   'Feature: hashed teacher tokens\n  Scenario: a teacher promotion is created\n    Given promote-to-teacher inserts a promotion\n    Then a BEFORE INSERT trigger stores only the SHA-256 token_hash\n  Scenario: confirmation looks up by hash\n    When the invited user confirms\n    Then confirm-teacher-role verifies via verify_teacher_promotion_token (hashed), never .eq(token) plaintext\n    And the verifier is not executable by anon or authenticated',
   'implemented', 'unit',
   'supabase/tests/confirm_role_tokens_test.sql',
   'H13: regression of 20260418032018 admin hardening, now mirrored for teacher_promotions.')
ON CONFLICT (scenario_id) DO UPDATE SET
  title = EXCLUDED.title, gherkin = EXCLUDED.gherkin, status = EXCLUDED.status,
  test_type = EXCLUDED.test_type, test_file = EXCLUDED.test_file,
  feature_area = EXCLUDED.feature_area, feature_area_number = EXCLUDED.feature_area_number,
  notes = EXCLUDED.notes, updated_at = now();

COMMIT;
