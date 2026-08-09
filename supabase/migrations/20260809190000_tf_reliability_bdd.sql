-- BDD scenarios for audit T-F standalone reliability/security fixes.
BEGIN;

INSERT INTO public.bdd_scenarios
  (scenario_id, feature_area, feature_area_number, title, gherkin, status, test_type, test_file, notes)
VALUES
  ('TF-RELIABILITY-001', 'Reliability', 63,
   'Standalone reliability/security defects that silently fail are hardened',
   'Feature: fail-closed reliability fixes\n  Scenario: DLP gate is stateless\n    Given repeated containsSensitive() calls on a payload holding a JWT\n    Then every call returns true (no /g lastIndex drift letting a secret leak)\n  Scenario: WAF survives malformed encoding\n    Given a URL with invalid percent-encoding (%zz)\n    When applyWaf runs\n    Then decodeURIComponent is guarded, it fails closed (400), and the request is not 500-crashed\n  Scenario: sanctions screening is a verified write\n    Given record_sanctions_screening fails to persist\n    Then screen-sanctions returns 503 (no allow/deny without the tamper-evident audit row)\n  Scenario: auth-prober two-strike debounce\n    Given a stage fails on a single run only\n    Then no page is sent (prior-run lookup runs BEFORE this run is inserted)',
   'implemented', 'unit',
   'src/test/smoke/tf-reliability.smoke.test.ts',
   'T-F: dlp.ts /g lastIndex, waf.ts decodeURIComponent guard, screen-sanctions checked audit write, auth-prober insert-after-prior. dlp behavior unit-tested; others are grep invariants.')
ON CONFLICT (scenario_id) DO UPDATE SET
  title = EXCLUDED.title, gherkin = EXCLUDED.gherkin, status = EXCLUDED.status,
  test_type = EXCLUDED.test_type, test_file = EXCLUDED.test_file,
  feature_area = EXCLUDED.feature_area, feature_area_number = EXCLUDED.feature_area_number,
  notes = EXCLUDED.notes, updated_at = now();

COMMIT;
