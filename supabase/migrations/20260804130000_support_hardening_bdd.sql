-- BDD scenarios for the support/Freescout hardening PR #1 (hardening + finish
-- existing flows). Executable coverage: src/test/smoke/support-hardening.smoke.test.ts
-- (CI vitest). status='implemented' — real, running tests.

INSERT INTO public.bdd_scenarios
  (scenario_id, feature_area, feature_area_number, title, gherkin, status, test_type, test_file, notes)
VALUES
  ('HELP-DESK-050', 'Help Desk', 7,
   'Service-role support functions use the shared authorizer',
   'Feature: Consistent service-role auth\n  Scenario: a cron worker calls a support function\n    Given a legacy service-role JWT or an opaque sb_secret_* token\n    Then provision-customer/sync-customer/provisioning-retry/monthly-report all accept it via authorizeServiceRoleRequest',
   'implemented', 'unit', 'src/test/smoke/support-hardening.smoke.test.ts',
   'Replaces bespoke string-equality that rejected sb_secret_* and would 401-storm on a key-format rollover.'),

  ('HELP-DESK-051', 'Help Desk', 7,
   'Assigning a ticket takes a platform admin UUID, not a raw Freescout id',
   'Feature: Safe assignment contract\n  Scenario: an admin assigns a ticket\n    Given the assign action\n    Then assigneeUserId is "self" or a platform admin UUID (resolved+provisioned server-side)\n    And raw numeric Freescout ids are rejected',
   'implemented', 'unit', 'src/test/smoke/support-hardening.smoke.test.ts',
   'Prevents targeting an arbitrary upstream Freescout user; mirrors the existing "self" resolution.'),

  ('HELP-DESK-052', 'Help Desk', 7,
   'A ticket can only be assigned to an admin',
   'Feature: Assignee authorization\n  Scenario: an admin assigns to a non-admin member\n    When freescout-proxy assign is called with a non-admin UUID\n    Then it returns 422 "Assignee must be an admin"',
   'implemented', 'unit', 'src/test/smoke/support-hardening.smoke.test.ts',
   'has_role(admin) verified for the target before provisioning.'),

  ('HELP-DESK-053', 'Help Desk', 7,
   'Admin actions never wipe a member''s ticket ownership',
   'Feature: Ownership integrity\n  Scenario: an admin closes/assigns/marks-private a ticket\n    When upsertPointer runs with a null owner arg\n    Then customer_user_id is preserved (not overwritten with null)\n    So the member keeps RLS visibility of their own ticket',
   'implemented', 'unit', 'src/test/smoke/support-hardening.smoke.test.ts',
   'Fixes a data-integrity bug: upsert customer_user_id=null onto the PK broke "members see own pointers" RLS.'),

  ('HELP-DESK-054', 'Help Desk', 7,
   'The assignable-admin roster RPC is admin-gated and hardened',
   'Feature: Agent roster\n  Scenario: the triage grid loads the "Assign to" picker\n    Given support_list_agents()\n    Then it is SECURITY DEFINER with a pinned empty search_path and raises insufficient_privilege for non-admins',
   'implemented', 'unit', 'src/test/smoke/support-hardening.smoke.test.ts',
   'A non-admin cannot enumerate staff; OWASP search-path hardening.'),

  ('HELP-DESK-055', 'Help Desk', 7,
   'Admins can self-assign, assign to another admin, and open the thread from the grid',
   'Feature: Triage grid actions\n  Scenario: an admin triages\n    Then they can Assign me (self), Assign to <admin> (picker), and click a row to read the conversation',
   'implemented', 'unit', 'src/test/smoke/support-hardening.smoke.test.ts',
   'Launch feature (assign to other admins) + fixes the "grid cannot open a thread" gap.'),

  ('HELP-DESK-056', 'Help Desk', 7,
   'The ticket thread view is shared by member and admin views',
   'Feature: Shared ticket detail\n  Scenario: member vs admin viewing a thread\n    Then both use the extracted TicketDetail component\n    And author labels reflect the viewer (member sees "You", admin sees "Customer")',
   'implemented', 'unit', 'src/test/smoke/support-hardening.smoke.test.ts',
   'Extracted from GetHelpPage; no duplicate copy; reply/close authz stays server-side.'),

  ('HELP-DESK-057', 'Help Desk', 7,
   'Admin provisioning resolves the profile by auth uid, never the row PK',
   'Feature: Provisioning correctness\n  Scenario: an admin self-provisions a help desk account\n    When freescout-provision-admin runs\n    Then it looks up profiles by user_id (auth uid), not id (PK)\n    And on-behalf-of provisioning verifies the target is an admin',
   'implemented', 'unit', 'src/test/smoke/support-hardening.smoke.test.ts',
   'Fixes a 404 on the default self-provision path (PK never equals auth.uid()).'),

  ('HELP-DESK-058', 'Help Desk', 7,
   'Webhook replay defense is the dedupe table, documented honestly',
   'Feature: Webhook replay model\n  Scenario: a signed webhook is replayed\n    Given FreeScout signs only the body (no timestamp)\n    Then the support_webhook_events dedupe returns {deduped:true} on repeats\n    And the unsigned date header is documented as not a security control',
   'implemented', 'unit', 'src/test/smoke/support-hardening.smoke.test.ts',
   'No security theater: timestamp-binding is impossible without FreeScout support; dedupe is the durable guard.')
ON CONFLICT (scenario_id) DO UPDATE SET
  title = EXCLUDED.title, gherkin = EXCLUDED.gherkin, status = EXCLUDED.status,
  test_type = EXCLUDED.test_type, test_file = EXCLUDED.test_file,
  notes = EXCLUDED.notes, updated_at = now();
