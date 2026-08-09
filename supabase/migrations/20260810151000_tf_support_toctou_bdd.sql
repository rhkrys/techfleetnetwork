-- BDD scenario for audit T-F — atomic Discord support rate limit.
BEGIN;

INSERT INTO public.bdd_scenarios
  (scenario_id, feature_area, feature_area_number, title, gherkin, status, test_type, test_file, notes)
VALUES
  ('TF-SUPPORT-TOCTOU-001', 'Reliability', 63,
   'Discord support rate limit increments atomically (no TOCTOU cap bypass)',
   'Feature: atomic per-member support cap\n  Scenario: concurrent taps cannot bypass the cap\n    Given the 10/hr Discord support cap\n    When two /support requests for the same member run concurrently\n    Then the counter increments atomically (single UPSERT RETURNING count), not read-then-write\n    And the cap is enforced (no last-writer-wins bypass)\n  Scenario: independent action buckets\n    Given a different action key\n    Then it is a separate rolling-hour bucket',
   'implemented', 'unit',
   'supabase/tests/support_rate_limit_for_test.sql',
   'T-F: _shared/support-ticket.ts (Discord path, no auth.uid()) replaced a read-then-upsert on support_rate_limits with support_check_rate_limit_for (service-role, atomic INSERT ... ON CONFLICT DO UPDATE SET count = count+1 RETURNING count). Migration 20260810150000. pgTAP proves cap boundary + atomic count + separate buckets; smoke asserts the racy pattern is gone.')
ON CONFLICT (scenario_id) DO UPDATE SET
  title = EXCLUDED.title, gherkin = EXCLUDED.gherkin, status = EXCLUDED.status,
  test_type = EXCLUDED.test_type, test_file = EXCLUDED.test_file,
  feature_area = EXCLUDED.feature_area, feature_area_number = EXCLUDED.feature_area_number,
  notes = EXCLUDED.notes, updated_at = now();

COMMIT;
