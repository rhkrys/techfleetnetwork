-- Registers the regression scenario that locks in the resolved incident behind
-- known_issue_catalog fingerprint 18d6186852440c10628b405e76ea6c466cee8e1c:
-- a Discord username search that returns 0 guild members is EXPECTED UX (the
-- member typed a handle not in the guild yet), classified severity:info and
-- returned as HTTP 200 "User not found" — never a system error.
--
-- The incident-gate (scripts/bdd-incident-gate.mjs) requires every active
-- match_kind='fingerprint' catalog entry to have a bdd_scenarios row whose
-- notes or test_file contains `incident:<slug>`. The slug below matches the
-- gate's tagFor(pattern) = first 40 chars of the fingerprint.
INSERT INTO public.bdd_scenarios (scenario_id, feature_area, feature_area_number, title, gherkin, status, test_type, test_file, notes)
VALUES (
  'DISCORD-RESOLVE-NOTFOUND-SEVERITY-001',
  'Discord',
  47,
  'Discord username-not-found is benign (severity:info), not a system error',
  'Feature: Discord handle resolution\n  Scenario: A member types a handle that is not in the guild yet\n    Given the guild member search returns zero candidates\n    When resolve-discord-id classifies the result\n    Then the audit event is tagged severity:info and result_count:0\n    And the response is HTTP 200 "User not found in server"\n    And it is never reported as a system error',
  'implemented',
  'unit',
  'supabase/functions/resolve-discord-id/result-classifier.test.ts',
  'Locks in resolved incident:18d6186852440c10628b405e76ea6c466cee8e1c — a 0-candidate Discord guild search is expected UX, classified severity:info (triage-skipped) and returned HTTP 200, not a system error. Regression guard: result-classifier.test.ts.'
)
ON CONFLICT (scenario_id) DO UPDATE SET
  title = EXCLUDED.title,
  gherkin = EXCLUDED.gherkin,
  status = EXCLUDED.status,
  test_type = EXCLUDED.test_type,
  test_file = EXCLUDED.test_file,
  notes = EXCLUDED.notes,
  updated_at = now();
