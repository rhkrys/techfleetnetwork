-- BDD scenario for audit H11 — resolve-discord-id interim ownership lockdown.
BEGIN;

INSERT INTO public.bdd_scenarios
  (scenario_id, feature_area, feature_area_number, title, gherkin, status, test_type, test_file, notes)
VALUES
  ('DISCORD-LINK-H11-001', 'Access control', 62,
   'A user cannot bind a Discord identity they have not proven they own',
   'Feature: Discord link ownership\n  Scenario: caller supplies an arbitrary guild member snowflake\n    Given a signed-in user posts confirm_user_id for an unlinked mentor/admin''s Discord account\n    When resolve-discord-id processes the confirm branch\n    Then no discord_user_id is written to the caller''s profile\n    And it returns 403 with code ownership_proof_required\n    And it audits discord_link_blocked_no_ownership_proof\n  Scenario: read-only username search still works\n    Given a signed-in user searches by discord_username\n    Then candidate results are returned without mutating any profile',
   'implemented', 'unit',
   'src/test/smoke/discord-link-ownership.smoke.test.ts',
   'H11 interim lockdown (2026-08-09): self-service snowflake binding disabled pending a real ownership-proof flow (bot-DM code or OAuth). Follow-up tracked.')
ON CONFLICT (scenario_id) DO UPDATE SET
  title = EXCLUDED.title, gherkin = EXCLUDED.gherkin, status = EXCLUDED.status,
  test_type = EXCLUDED.test_type, test_file = EXCLUDED.test_file,
  feature_area = EXCLUDED.feature_area, feature_area_number = EXCLUDED.feature_area_number,
  notes = EXCLUDED.notes, updated_at = now();

COMMIT;
