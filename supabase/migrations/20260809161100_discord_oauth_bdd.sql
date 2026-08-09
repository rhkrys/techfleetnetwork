-- BDD scenarios for audit H11 follow-up — the permanent Discord ownership-proof
-- flow (OAuth authorization_code) that replaces the interim lockdown.
BEGIN;

-- H11-001 evolves from "binding is disabled" to the durable security invariant:
-- binding requires PROOF the caller controls the Discord account.
INSERT INTO public.bdd_scenarios
  (scenario_id, feature_area, feature_area_number, title, gherkin, status, test_type, test_file, notes)
VALUES
  ('DISCORD-LINK-H11-001', 'Access control', 62,
   'A user cannot bind a Discord identity they have not proven they own',
   'Feature: Discord link ownership\n  Scenario: caller-supplied snowflake is never written without proof\n    Given resolve-discord-id has no ownership-proof mechanism\n    When any confirm_user_id is posted to resolve-discord-id\n    Then no discord_user_id is written to the caller''s profile\n    And the only path that writes discord_user_id is discord-oauth-callback after a verified /users/@me match',
   'implemented', 'unit',
   'src/test/smoke/discord-link-ownership.smoke.test.ts',
   'H11 permanent fix (2026-08-09): self-service binding now requires Discord OAuth proof. resolve-discord-id no longer binds; discord-oauth-callback binds only the OAuth-verified snowflake.'),

  ('DISCORD-LINK-H11-002', 'Access control', 62,
   'Discord OAuth authorization proves ownership before binding',
   'Feature: Discord link via OAuth\n  Scenario: happy path\n    Given a signed-in user starts the Discord OAuth flow and a single-use state is minted for them\n    When Discord redirects back with a valid code and that state\n    And discord-oauth-callback exchanges the code and reads /users/@me\n    Then the returned snowflake is written to that user''s profile\n    And has_discord_account becomes true\n    And discord_link_verified_oauth is audited\n  Scenario: snowflake already linked to another profile\n    Given the OAuth-verified snowflake is already on a different profile\n    When discord-oauth-callback tries to bind it\n    Then the write is rejected with 409 and the caller''s profile is unchanged',
   'implemented', 'unit',
   'supabase/functions/discord-oauth-callback/decide.test.ts',
   'OAuth authorization_code -> /users/@me snowflake match is the ownership proof. Keeps the pre-existing already-linked (unique index) and empty-username guards.'),

  ('DISCORD-LINK-H11-003', 'Access control', 62,
   'OAuth state nonce is single-use, expiring, and bound to one user',
   'Feature: Discord OAuth state integrity\n  Scenario: replay\n    Given a state has already been consumed\n    When the callback is retried with the same state\n    Then consume_discord_oauth_state returns null and no binding occurs\n  Scenario: cross-user theft\n    Given a state minted for user A\n    When user B presents it with B''s own JWT\n    Then consume_discord_oauth_state returns null because user_id does not match\n  Scenario: expiry\n    Given a state older than its TTL\n    When it is presented\n    Then consume_discord_oauth_state returns null',
   'implemented', 'unit',
   'supabase/tests/discord_oauth_states_test.sql',
   'Atomic single-use UPDATE ... WHERE consumed_at IS NULL AND expires_at > now() bound to user_id. RLS deny-all to anon/authenticated.')
ON CONFLICT (scenario_id) DO UPDATE SET
  title = EXCLUDED.title, gherkin = EXCLUDED.gherkin, status = EXCLUDED.status,
  test_type = EXCLUDED.test_type, test_file = EXCLUDED.test_file,
  feature_area = EXCLUDED.feature_area, feature_area_number = EXCLUDED.feature_area_number,
  notes = EXCLUDED.notes, updated_at = now();

COMMIT;
