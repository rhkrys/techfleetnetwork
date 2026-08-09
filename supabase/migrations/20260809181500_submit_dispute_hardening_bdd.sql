-- BDD scenario for audit T-H — submit-dispute cost/abuse hardening.
BEGIN;

INSERT INTO public.bdd_scenarios
  (scenario_id, feature_area, feature_area_number, title, gherkin, status, test_type, test_file, notes)
VALUES
  ('SUBMIT-DISPUTE-TH-001', 'Access control', 62,
   'Dispute submissions are rate-limited and leak no internal errors',
   'Feature: bounded dispute submission\n  Scenario: dispute flood from one IP\n    Given the same IP submits more than 5 disputes in an hour\n    Then submit-dispute returns 429 rate_limited (no further dispute_intake rows, no admin-tab flood)\n  Scenario: RPC failure\n    Given the submit_dispute RPC errors\n    Then the client receives a generic internal_error (detail logged server-side only)',
   'implemented', 'unit',
   'src/test/smoke/submit-dispute-hardening.smoke.test.ts',
   'T-H: per-IP cap via check_edge_rate_limit (5/hour). The unauth-insert vector is already narrowed by verify_jwt=true; this adds defense-in-depth + generic errors. NOTE: recon flagged submit_dispute RPC EXECUTE may be over-revoked (anon/authenticated) — separate feature-availability check for later.')
ON CONFLICT (scenario_id) DO UPDATE SET
  title = EXCLUDED.title, gherkin = EXCLUDED.gherkin, status = EXCLUDED.status,
  test_type = EXCLUDED.test_type, test_file = EXCLUDED.test_file,
  feature_area = EXCLUDED.feature_area, feature_area_number = EXCLUDED.feature_area_number,
  notes = EXCLUDED.notes, updated_at = now();

COMMIT;
