-- BDD scenario for audit T-H — outbound edge fetches have a hard timeout.
BEGIN;

INSERT INTO public.bdd_scenarios
  (scenario_id, feature_area, feature_area_number, title, gherkin, status, test_type, test_file, notes)
VALUES
  ('TH-FETCH-TIMEOUT-001', 'Unauth abuse / DoS', 66,
   'Outbound edge fetches cannot hang a cron tick indefinitely',
   'Feature: bounded outbound fetches\n  Scenario: a hung Discord webhook is aborted\n    Given an outbound Discord POST that never responds\n    When fetchWithTimeout runs with a timeout\n    Then the request is aborted at the deadline and the AbortError propagates to the existing catch\n    And the email health / auto-pause cron tick is not blocked\n  Scenario: a fast response passes through\n    Given the remote responds before the timeout\n    Then the response is returned and no abort fires',
   'implemented', 'unit',
   'src/test/smoke/fetch-timeout.smoke.test.ts',
   'T-H: refresh-email-health (2 webhook posts) + send-announcement-email (Discord post) made bare fetch() calls with no timeout → a hung webhook stalled the cron. Shared _shared/fetch-timeout.ts fetchWithTimeout() (AbortController, 10s default) now wraps them. resolve-discord-id .or() item was already removed by the H11 OAuth rework (#168).')
ON CONFLICT (scenario_id) DO UPDATE SET
  title = EXCLUDED.title, gherkin = EXCLUDED.gherkin, status = EXCLUDED.status,
  test_type = EXCLUDED.test_type, test_file = EXCLUDED.test_file,
  feature_area = EXCLUDED.feature_area, feature_area_number = EXCLUDED.feature_area_number,
  notes = EXCLUDED.notes, updated_at = now();

COMMIT;
