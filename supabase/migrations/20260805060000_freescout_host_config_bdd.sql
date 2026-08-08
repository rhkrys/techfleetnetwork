-- BDD scenario for the Freescout host-config hardening (support feature).
-- Executable coverage: supabase/functions/_shared/freescout.test.ts (deno test,
-- run in CI's deno-check job). status='implemented' — real, running test.

INSERT INTO public.bdd_scenarios
  (scenario_id, feature_area, feature_area_number, title, gherkin, status, test_type, test_file, notes)
VALUES
  ('HELP-DESK-059', 'Help Desk', 7,
   'Freescout base URL is env-overridable and https-enforced',
   'Feature: Resilient Freescout host config\n  Scenario: the PikaPods pod host changes\n    Given FREESCOUT_BASE_URL is unset\n    Then the client defaults to the current pod (https://bulky-kagu.pikapod.net)\n  Scenario: moving servers without a code change\n    Given FREESCOUT_BASE_URL is set to an https URL\n    Then the client uses it (and the derived host stays the SSRF allowlist)\n  Scenario: a misconfigured non-https URL\n    Given FREESCOUT_BASE_URL is http://\n    Then module load throws — the API/webhook channel is never downgraded',
   'implemented', 'unit', 'supabase/functions/_shared/freescout.test.ts',
   'Root-causes the twice-repeated outage: a hardcoded *.pikapod.net host silently broke when PikaPods reassigned the pod (meteoric-hare -> bulky-kagu). Now config, not code; https guard added per OWASP.')
ON CONFLICT (scenario_id) DO UPDATE SET
  title = EXCLUDED.title, gherkin = EXCLUDED.gherkin, status = EXCLUDED.status,
  test_type = EXCLUDED.test_type, test_file = EXCLUDED.test_file,
  feature_area = EXCLUDED.feature_area, feature_area_number = EXCLUDED.feature_area_number,
  notes = EXCLUDED.notes, updated_at = now();
