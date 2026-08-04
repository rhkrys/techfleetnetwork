-- BDD scenarios for declarative, deploy-time Discord slash-command registration.
-- Executable coverage: src/test/unit/discord-command-plan.test.ts (001-004),
-- src/test/smoke/discord-command-registration.smoke.test.ts (005-006).
INSERT INTO public.bdd_scenarios
  (scenario_id, feature_area, feature_area_number, title, gherkin, status, test_type, test_file, notes)
VALUES
  ('DISCORD-CMD-001', 'Help Desk', 7,
   'The command manifest declares fleety + support with required options',
   'Feature: Declarative command manifest\n  Scenario: the manifest is the single source of truth\n    Then it declares fleety and support\n    And support has required subject + details options',
   'implemented', 'unit', 'src/test/unit/discord-command-plan.test.ts',
   'src/lib/discord/command-plan.ts COMMANDS; consumed by the CI registrar.'),
  ('DISCORD-CMD-002', 'Help Desk', 7,
   'Registration is idempotent when Discord already matches the manifest',
   'Feature: Idempotent registration\n  Scenario: Discord is already in sync\n    When the registrar plans changes\n    Then there are no deletions and the run is not blocked',
   'implemented', 'unit', 'src/test/unit/discord-command-plan.test.ts',
   'planCommandChanges returns empty deletions; bulk overwrite is a no-op.'),
  ('DISCORD-CMD-003', 'Help Desk', 7,
   'Registration refuses to delete a command missing from the manifest',
   'Feature: Accidental-deletion guard (OWASP Step 0)\n  Scenario: a registered command is not in the manifest\n    When the registrar plans changes without an override\n    Then it is blocked and names what would be deleted',
   'implemented', 'unit', 'src/test/unit/discord-command-plan.test.ts',
   'Bulk overwrite would wipe unlisted commands (e.g. fleety); guard prevents it.'),
  ('DISCORD-CMD-004', 'Help Desk', 7,
   'Deletion proceeds only with an explicit override',
   'Feature: Explicit deletion\n  Scenario: intentional removal\n    When the registrar runs with --allow-delete\n    Then the removal proceeds and is logged',
   'implemented', 'unit', 'src/test/unit/discord-command-plan.test.ts',
   'workflow_dispatch allow_delete input threads through to --allow-delete.'),
  ('DISCORD-CMD-005', 'Help Desk', 7,
   'Secrets are env-sourced, never logged, and missing secrets fail closed',
   'Feature: Secret safety\n  Scenario: the registrar runs\n    Then the bot token is read from env and used only in the Authorization header\n    And it is never logged\n    And missing DISCORD_BOT_TOKEN/APPLICATION_ID skips cleanly (registers nothing)',
   'implemented', 'unit', 'src/test/smoke/discord-command-registration.smoke.test.ts',
   'Replaces the browser-console functions.invoke() step; CI runs it via tsx.'),
  ('DISCORD-CMD-006', 'Help Desk', 7,
   'Target is guild-scoped when DISCORD_GUILD_ID is set, else global',
   'Feature: Registration target\n  Scenario: choosing scope\n    Given DISCORD_GUILD_ID is set\n    Then commands register to that guild (instant); otherwise globally',
   'implemented', 'unit', 'src/test/smoke/discord-command-registration.smoke.test.ts',
   'Idempotent bulk PUT to the guild or global commands endpoint.')
ON CONFLICT (scenario_id) DO UPDATE SET
  title = EXCLUDED.title, gherkin = EXCLUDED.gherkin, status = EXCLUDED.status,
  test_type = EXCLUDED.test_type, test_file = EXCLUDED.test_file,
  notes = EXCLUDED.notes, updated_at = now();
