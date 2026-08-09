-- BDD scenario for audit T-C — client-controlled headers not trusted for security.
BEGIN;

INSERT INTO public.bdd_scenarios
  (scenario_id, feature_area, feature_area_number, title, gherkin, status, test_type, test_file, notes)
VALUES
  ('HEADER-HARDENING-TC-001', 'Access control', 62,
   'Spoofable request headers cannot defeat rate limits or forge audit trails',
   'Feature: untrusted client headers\n  Scenario: spoofed X-Forwarded-For\n    Given a request with a forged leftmost X-Forwarded-For and a real cf-connecting-ip\n    When an edge fn resolves the client IP\n    Then it uses cf-connecting-ip (not the spoofable leftmost XFF)\n  Scenario: understated Content-Length\n    Given a POST that omits/understates Content-Length but streams a large body\n    When parseJsonBody / a bounded reader consumes it\n    Then it aborts at the byte cap (413) instead of buffering unbounded',
   'implemented', 'unit',
   'src/test/smoke/tc-header-hardening.smoke.test.ts',
   'T-C: shared _shared/client-ip.ts (cf-connecting-ip first) + _shared/bounded-body.ts (streaming cap). Adopted in compliance.ts (re-export), waf.ts (clientIpOr), http.ts parseJsonBody. Per-endpoint bounded-reader adoption (record-web-vital/freescout-webhook/techfleet-chat) follows in their batches.')
ON CONFLICT (scenario_id) DO UPDATE SET
  title = EXCLUDED.title, gherkin = EXCLUDED.gherkin, status = EXCLUDED.status,
  test_type = EXCLUDED.test_type, test_file = EXCLUDED.test_file,
  feature_area = EXCLUDED.feature_area, feature_area_number = EXCLUDED.feature_area_number,
  notes = EXCLUDED.notes, updated_at = now();

COMMIT;
