-- BDD scenario for audit T-H — unauth cost/DoS on public endpoints.
BEGIN;

INSERT INTO public.bdd_scenarios
  (scenario_id, feature_area, feature_area_number, title, gherkin, status, test_type, test_file, notes)
VALUES
  ('PUBLIC-DOS-TH-001', 'Access control', 62,
   'Public edge endpoints throttle per-IP and bound request bodies',
   'Feature: bounded public endpoints\n  Scenario: web-vital beacon flood\n    Given the same IP posts more than the per-minute cap to record-web-vital\n    Then check_edge_rate_limit blocks and the beacon is dropped (204), no INSERT\n  Scenario: oversized/understated body\n    Given a record-web-vital POST that omits Content-Length but streams a huge body\n    Then readBoundedText aborts at the 64KB cap (204), no unbounded buffering\n  Scenario: i18n cache-bypass flood\n    Given one IP cycles novel locale/namespace on get-i18n-bundle past the cap\n    Then it returns 429 rate_limited instead of a service-role query + SHA-256 per hit',
   'implemented', 'unit',
   'src/test/smoke/th-public-dos.smoke.test.ts',
   'T-H: generic dedicated limiter edge_rate_limits + check_edge_rate_limit (RPC proven in supabase/tests/edge_rate_limit_test.sql). record-web-vital also drops the reflect-Origin+Allow-Credentials CORS anti-pattern; get-i18n-bundle returns generic errors. Keyed on cf-connecting-ip (T-C).')
ON CONFLICT (scenario_id) DO UPDATE SET
  title = EXCLUDED.title, gherkin = EXCLUDED.gherkin, status = EXCLUDED.status,
  test_type = EXCLUDED.test_type, test_file = EXCLUDED.test_file,
  feature_area = EXCLUDED.feature_area, feature_area_number = EXCLUDED.feature_area_number,
  notes = EXCLUDED.notes, updated_at = now();

COMMIT;
