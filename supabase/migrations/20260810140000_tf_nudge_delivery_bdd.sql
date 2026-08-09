-- BDD scenario for audit T-F — one-shot reminder / debounce timestamps must
-- only advance on actual delivery.
BEGIN;

INSERT INTO public.bdd_scenarios
  (scenario_id, feature_area, feature_area_number, title, gherkin, status, test_type, test_file, notes)
VALUES
  ('TF-NUDGE-DELIVERY-001', 'Reliability', 63,
   'Reminder/nudge one-shot timestamps advance only when the message was delivered',
   'Feature: no silent loss of reminders/nudges\n  Scenario: failed email does not burn the one-shot reminder\n    Given resume-application-reminder sends the resume email\n    And send-transactional-email returns { error } (invoke does not throw)\n    And no in-app notification was written\n    Then resume_reminder_sent_at is NOT stamped (the reminder is retried next run)\n  Scenario: failed nudge does not suppress for the debounce window\n    Given quest-nudge both fails the notification insert and the email\n    Then last_nudged_at is NOT advanced (the user is not suppressed for 7 days undelivered)\n  Scenario: delivery on any channel advances the gate\n    Given the in-app notification succeeded OR an attempted email sent ok\n    Then the one-shot/debounce timestamp is stamped',
   'implemented', 'unit',
   'src/test/smoke/nudge-delivery.smoke.test.ts',
   'T-F: supabase.functions.invoke resolves with { error } on non-2xx (does NOT throw); the try/catch missed it so the stamp advanced on failure. Fix: _shared/nudge-delivery.ts wasDelivered() gates the stamp in resume-application-reminder + quest-nudge; email error now captured from the invoke result.')
ON CONFLICT (scenario_id) DO UPDATE SET
  title = EXCLUDED.title, gherkin = EXCLUDED.gherkin, status = EXCLUDED.status,
  test_type = EXCLUDED.test_type, test_file = EXCLUDED.test_file,
  feature_area = EXCLUDED.feature_area, feature_area_number = EXCLUDED.feature_area_number,
  notes = EXCLUDED.notes, updated_at = now();

COMMIT;
