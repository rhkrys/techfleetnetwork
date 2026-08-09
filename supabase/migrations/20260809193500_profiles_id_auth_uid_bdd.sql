-- BDD scenario for audit T-A — profiles.id (PK) vs auth.uid() (== user_id).
BEGIN;

INSERT INTO public.bdd_scenarios
  (scenario_id, feature_area, feature_area_number, title, gherkin, status, test_type, test_file, notes)
VALUES
  ('TA-IDENTITY-001', 'Identity Integrity', 64,
   'Consent and identity lookups key on user_id, never the profiles PK',
   'Feature: profiles.id vs auth.uid() integrity\n  Scenario: record_policy_ack persists consent\n    Given an authenticated user acknowledges a policy with electronic_comms = true\n    When record_policy_ack runs\n    Then profiles.electronic_comms_consent_at is set (UPDATE keyed on user_id = auth.uid(), not the random PK)\n  Scenario: regression guard flags the confusion\n    Given an edge fn or post-cutoff migration keys public.profiles on id = an auth uid\n    When check-profiles-id-auth-uid runs in CI\n    Then it fails the build\n  Scenario: genuine PK lookups are allowed\n    Given a profiles row already resolved by user_id, then touched by .eq("id", prof.id)\n    Then the guard does not flag it',
   'implemented', 'unit',
   'src/test/smoke/profiles-id-auth-uid.smoke.test.ts',
   'T-A: record_policy_ack UPDATE keyed on the random PK matched 0 rows so consent never persisted. Fix = user_id = auth.uid(). Guard scripts/ci/check-profiles-id-auth-uid.mjs (lint-arch) + pgTAP supabase/tests/record_policy_ack_test.sql. Edge-fn shape fixes landed in #175.')
ON CONFLICT (scenario_id) DO UPDATE SET
  title = EXCLUDED.title, gherkin = EXCLUDED.gherkin, status = EXCLUDED.status,
  test_type = EXCLUDED.test_type, test_file = EXCLUDED.test_file,
  feature_area = EXCLUDED.feature_area, feature_area_number = EXCLUDED.feature_area_number,
  notes = EXCLUDED.notes, updated_at = now();

COMMIT;
