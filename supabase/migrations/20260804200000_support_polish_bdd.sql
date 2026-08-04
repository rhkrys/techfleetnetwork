-- BDD scenarios for the support polish PR (#5 idempotency, #7 sweep scale).
-- Executable coverage: src/test/smoke/support-polish.smoke.test.ts.
INSERT INTO public.bdd_scenarios
  (scenario_id, feature_area, feature_area_number, title, gherkin, status, test_type, test_file, notes)
VALUES
  ('HELP-DESK-090', 'Help Desk', 7,
   'Ticket creation is idempotent on both create paths',
   'Feature: No duplicate tickets\n  Scenario: a member double-submits / retries create\n    Given they open the same subject twice within a short window\n    When create runs (web or Discord)\n    Then the existing ticket is returned, not a duplicate',
   'implemented', 'unit', 'src/test/smoke/support-polish.smoke.test.ts',
   'recentDuplicateTicketId (owner+subject, 2-min window); web path inlines the same guard.'),
  ('MEM-SCALE-001', 'Membership', 60,
   'The membership drift sweep scales to 10k users',
   'Feature: Scoped reprojection\n  Scenario: the nightly/weekly drift sweep runs\n    Then it re-projects only non-starter or has-sale profiles (skipping provably-starter, no-sale rows)\n    And the invariant tripwire is unchanged',
   'implemented', 'unit', 'src/test/smoke/support-polish.smoke.test.ts',
   'Correctness-preserving: a starter profile with no sales cannot have drifted. O(paying) not O(all).')
ON CONFLICT (scenario_id) DO UPDATE SET
  title = EXCLUDED.title, gherkin = EXCLUDED.gherkin, status = EXCLUDED.status,
  test_type = EXCLUDED.test_type, test_file = EXCLUDED.test_file,
  notes = EXCLUDED.notes, updated_at = now();
