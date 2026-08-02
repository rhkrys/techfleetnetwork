INSERT INTO public.bdd_scenarios (scenario_id, feature_area, feature_area_number, title, gherkin, status, test_type, test_file, notes)
VALUES (
  'ARCH-EDGE-PUBLIC-HTTP-003',
  'Architecture',
  99,
  'Public edge functions use shared HTTP helpers and redact sensitive logs',
  'Feature: Edge function architecture\n  Scenario: A recipient uses an email unsubscribe link\n    Given a public unsubscribe token is submitted by GET or POST\n    When the backend function validates and consumes the token\n    Then it uses shared CORS and JSON response helpers\n    And it keeps the existing one-click unsubscribe behavior\n    And it does not log unsubscribe tokens or recipient emails on failures',
  'implemented',
  'unit',
  'supabase/functions/handle-email-unsubscribe/index.ts',
  'Covers the shared HTTP/admin-client refactor and log redaction hardening for the public unsubscribe backend function.'
)
ON CONFLICT (scenario_id) DO UPDATE SET
  title = EXCLUDED.title,
  gherkin = EXCLUDED.gherkin,
  status = EXCLUDED.status,
  test_type = EXCLUDED.test_type,
  test_file = EXCLUDED.test_file,
  notes = EXCLUDED.notes,
  updated_at = now();
