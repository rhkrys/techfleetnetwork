-- BDD for Wave-0 auth remediation (audit C1 + C2). Executable coverage:
--   supabase/functions/process-freescout-events/auth.test.ts (deno, CI edge-unit-gates)
--   scripts/ci/check-no-unsigned-jwt-auth.mjs (anti-regression lint, CI lint-arch)

INSERT INTO public.bdd_scenarios
  (scenario_id, feature_area, feature_area_number, title, gherkin, status, test_type, test_file, notes)
VALUES
  ('AUTH-SVC-001', 'Security', 90,
   'Service-role endpoints reject a forged, unsigned JWT',
   'Feature: Service-role authorization is signature-safe\n  Scenario: forged service_role JWT is rejected\n    Given an attacker crafts a token header.<base64 {"role":"service_role"}>.<any-signature>\n    When they call any verify_jwt=false worker via authorizeServiceRoleRequest\n    Then the request is rejected with 403\n    And the request never runs with the service role\n  Scenario: the exact service-role key is accepted\n    Given a caller presents Bearer <SUPABASE_SERVICE_ROLE_KEY>\n    Then authorization succeeds (constant-time exact match)\n  Scenario: cron workers are unaffected\n    Given pg_cron invokes workers with the Vault service-role key\n    Then they continue to authorize (exact match), no 401 storm',
   'implemented', 'unit', 'supabase/functions/process-freescout-events/auth.test.ts',
   'C1: _shared/service-role-auth.ts no longer decodes/​trusts an unsigned JWT role claim; 4 hand-rolled copies (fleety-embed, notify-critical-fix, triage-digest-builder, refresh-community-events) now use the shared exact-match authorizer. The prior test asserted the forged token was ACCEPTED; it now asserts rejection.'),
  ('AUTH-SVC-002', 'Security', 90,
   'The public anon key can never authorize a privileged endpoint',
   'Feature: No privilege from a public key\n  Scenario: anon key does not grant service role\n    Given the anon key is public (shipped in the frontend bundle)\n    When a user calls fleety-learning-digest with Bearer <anon_key>\n    Then they do NOT run as service role\n    And they are only allowed through if they are a verified admin (has_role admin)\n    Else the request is rejected (401/403)',
   'implemented', 'unit', 'scripts/ci/check-no-unsigned-jwt-auth.mjs',
   'C2: fleety-learning-digest previously gated on auth.includes(ANON_KEY). Now requires exact service-role match or a verified admin JWT.'),
  ('AUTH-SVC-003', 'Security', 90,
   'CI structurally blocks re-introduction of unsigned-JWT / anon-key authorization',
   'Feature: Anti-regression guard\n  Scenario: a new function decodes and trusts an unverified service_role claim\n    Given a PR adds atob()-decoding of a bearer token and trusts role="service_role"\n    When CI runs check-no-unsigned-jwt-auth.mjs\n    Then the build fails\n  Scenario: a new function authorizes via .includes() of an ANON key\n    Then the build fails',
   'implemented', 'unit', 'scripts/ci/check-no-unsigned-jwt-auth.mjs',
   'Guard runs in CI (lint-arch). Escape hatch: // @safe-service-auth with written justification.')
ON CONFLICT (scenario_id) DO UPDATE SET
  title = EXCLUDED.title, gherkin = EXCLUDED.gherkin, status = EXCLUDED.status,
  test_type = EXCLUDED.test_type, test_file = EXCLUDED.test_file,
  feature_area = EXCLUDED.feature_area, feature_area_number = EXCLUDED.feature_area_number,
  notes = EXCLUDED.notes, updated_at = now();
