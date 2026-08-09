-- BDD scenario for audit T-D — stored XSS via notification title/body_html.
BEGIN;

INSERT INTO public.bdd_scenarios
  (scenario_id, feature_area, feature_area_number, title, gherkin, status, test_type, test_file, notes)
VALUES
  ('NOTIF-XSS-TD-001', 'Access control', 62,
   'User/teacher-controlled text is escaped before it reaches a notification',
   'Feature: notification stored-XSS prevention\n  Scenario: quest nudge with a hostile quest title\n    Given a quest path_title containing HTML/script\n    When quest-nudge writes the notification\n    Then path_title is escaped (escapeHtml) in both title and body_html\n  Scenario: interview-scheduled with a hostile applicant name\n    Given an applicantName containing HTML\n    When mark-interview-scheduled builds the notification title\n    Then the title uses the escaped name (safeApplicantName), matching the body',
   'implemented', 'unit',
   'src/test/smoke/notification-xss.smoke.test.ts',
   'T-D: shared _shared/escape-html.ts (unit-tested); the notification render path trusts stored HTML, so writers escape at the insert boundary. Siblings send-project-blast (DB sanitize trigger) / notify already safe.')
ON CONFLICT (scenario_id) DO UPDATE SET
  title = EXCLUDED.title, gherkin = EXCLUDED.gherkin, status = EXCLUDED.status,
  test_type = EXCLUDED.test_type, test_file = EXCLUDED.test_file,
  feature_area = EXCLUDED.feature_area, feature_area_number = EXCLUDED.feature_area_number,
  notes = EXCLUDED.notes, updated_at = now();

COMMIT;
