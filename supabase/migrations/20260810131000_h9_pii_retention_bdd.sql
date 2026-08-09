-- BDD scenario for audit H9 — email/Gumroad PII retention + GDPR erasure.
BEGIN;

INSERT INTO public.bdd_scenarios
  (scenario_id, feature_area, feature_area_number, title, gherkin, status, test_type, test_file, notes)
VALUES
  ('H9-PII-RETENTION-001', 'Compliance / Data Lifecycle', 65,
   'Email and Gumroad PII is minimized, retained with limits, and erased on account deletion',
   'Feature: PII retention & GDPR erasure for email + Gumroad sinks\n  Scenario: durable email log stores no rendered content\n    Given a transactional email is queued\n    Then email_send_log.metadata holds only operational refs + a payload_sha256 hash (no html/text/subject/templateData)\n    And the full payload lives only in the transient pgmq queue\n  Scenario: erasure propagates to email + Gumroad\n    Given a user with email_send_log rows and a gumroad_sales row is deleted\n    When handle_user_deletion runs\n    Then their email_send_log rows are deleted\n    And their gumroad_sales email is redacted and raw_payload dropped (ledger/financial row preserved)\n  Scenario: raw Gumroad payloads are retention-pruned\n    Given a gumroad_sales row older than 180 days\n    When prune_gumroad_raw_payloads runs (daily cron)\n    Then its raw_payload is redacted while recent rows are untouched',
   'implemented', 'unit',
   'supabase/tests/gdpr_erasure_email_gumroad_test.sql',
   'H9: transactional-email.ts strips queue_payload/templateData from the durable log (payload_sha256 instead); migration 20260810130000 adds email_send_log + gumroad_sales scrubbing to handle_user_deletion, back-fills historical metadata, and adds prune_gumroad_raw_payloads (180d) cron. pgTAP proves erasure + prune; smoke email-reconciliation asserts the log has no rendered content.')
ON CONFLICT (scenario_id) DO UPDATE SET
  title = EXCLUDED.title, gherkin = EXCLUDED.gherkin, status = EXCLUDED.status,
  test_type = EXCLUDED.test_type, test_file = EXCLUDED.test_file,
  feature_area = EXCLUDED.feature_area, feature_area_number = EXCLUDED.feature_area_number,
  notes = EXCLUDED.notes, updated_at = now();

COMMIT;
