
-- Resolve the existing freescout reply error row now that the root-cause fix shipped.
UPDATE public.agent_fix_queue
SET status = 'resolved', resolved_at = now()
WHERE id = '05576857-8ae8-410b-babf-c0a46a00919d';

-- BDD scenarios for the Get Help admin reply + member notification flow.
INSERT INTO public.bdd_scenarios (feature_area, feature_area_number, scenario_id, title, gherkin, status, test_type, notes)
VALUES
('Get Help admin actions', 25, 'HELP-DESK-025', 'Admin self-assigns an unassigned ticket',
'Feature: Get Help admin actions

Scenario: Admin self-assigns an unassigned ticket
  Given an admin views Get Help > Admin tickets > Open unassigned
  And their profiles.freescout_user_id is provisioned
  When they click "Assign me" on row T
  Then [UI] A success toast "Assigned to you." appears within 1s and the row moves to Open assigned on next refetch
  And [DB] support_ticket_pointers.assignee_user_id for T.conversation_id equals the admin freescout_user_id
  And [Code] freescout-proxy receives action:assign assigneeUserId:"self", resolves it to the admin freescout_user_id, and PUTs /api/conversations/{id} {assignTo:<int>} returning 200',
'implemented', 'manual', 'Root-cause fix for AdminAllTicketsGrid sending assigneeUserId:0.'),

('Get Help admin actions', 26, 'HELP-DESK-026', 'Admin self-assigns while not yet provisioned',
'Feature: Get Help admin actions

Scenario: Admin self-assigns while not yet provisioned
  Given an admin whose profiles.freescout_user_id is null
  When they click "Assign me"
  Then [UI] The proxy auto-provisions the admin Freescout user on the same request and the assignment succeeds without manual intervention
  And [DB] profiles.freescout_user_id is populated after the call
  And [Code] resolveAdminFreescoutUserId looks up the profile, calls findUserByEmail/createUser, persists the id, then forwards assignTo to Freescout',
'implemented', 'manual', 'Inline provisioning removes the manual /admin/confirm-admin step.'),

('Get Help admin actions', 27, 'HELP-DESK-027', 'Admin replies to an open ticket',
'Feature: Get Help admin actions

Scenario: Admin replies to an open ticket
  Given the admin opens ticket T and types a reply
  When they click "Send reply"
  Then [UI] The reply textarea clears, toast "Reply sent." appears, and the new thread appears on next refetch
  And [DB] support_ticket_events gains a row event_type:"convo.user.replied" actor_kind:"user" for conversation_id T and support_ticket_pointers.last_synced_at advances
  And [Code] freescout-proxy POSTs /api/conversations/{T}/threads with {type:"message", text, user:<admin freescout_user_id>} returning 201',
'implemented', 'manual', 'Adds required user field that Freescout 422-rejected when omitted.'),

('Get Help member notifications', 28, 'HELP-DESK-028', 'Member receives in-app and email when admin replies',
'Feature: Get Help member notifications

Scenario: Member receives in-app and email when admin replies
  Given member M created ticket T and has profiles.email = m@example.com
  When an admin replies and process-freescout-events drains the convo.user.replied payload
  Then [UI] Within 30s M sees a header notification "New reply on your ticket" linking to /community/get-help?ticket=T
  And [DB] one notifications row exists with user_id=M category=support link=/community/get-help?ticket=T, and one email_send_log row exists with template_name=support-ticket-reply idempotency_key=support-reply-T-<threadId>
  And [Code] processOne invokes send-transactional-email exactly once and a second drain of the same event_id does NOT enqueue a duplicate email (pgmq dedupe + email idempotency key)',
'implemented', 'manual', 'Adds branded customer email to existing in-app notification fan-out.'),

('Get Help member notifications', 29, 'HELP-DESK-029', 'Customer replies to their own ticket regression',
'Feature: Get Help member notifications

Scenario: Customer replies to their own ticket regression
  Given member M has ticket T open
  When M types a reply and clicks "Send reply"
  Then [UI] Toast "Reply sent." appears and the new thread appears in M view
  And [DB] support_ticket_events.event_type=convo.customer.replied and no email_send_log row for support-ticket-reply is created
  And [Code] freescout-proxy POSTs {type:"customer", text, customer:{email:M.email}} with NO user field',
'implemented', 'manual', 'Confirms admin-only branch does not regress the customer path.'),

('Get Help observability', 30, 'HELP-DESK-030', 'Upstream Freescout error is actionable in triage',
'Feature: Get Help observability

Scenario: Upstream Freescout error is actionable in triage
  Given Freescout returns 422 {error:"validation_failed: user"} to an admin reply
  When auditedInvoke records the failure
  Then [UI] The admin sees toast "Could not send your reply."
  And [DB] agent_fix_queue gains/updates a row with event_type=edge_invoke_failed severity=warn and extra_fields contains upstream:422 and upstream_code:validation_failed
  And [Code] freescoutInvoke clones result.error.context and appends upstream:<status> upstream_code:<code> to extras alongside the trace id',
'implemented', 'manual', 'Surfaces the real Freescout reason in triage instead of opaque invoke_error.'),

('Get Help admin actions', 31, 'HELP-DESK-031', 'Reply forbidden when not owner and not admin',
'Feature: Get Help admin actions

Scenario: Reply forbidden when not owner and not admin
  Given member B is signed in and tries to POST freescout-proxy {action:"reply", conversationId:T_of_A} directly
  When the proxy validates ownership
  Then [Code] proxy returns 403 Forbidden
  And [DB] no support_ticket_events row is inserted and no email is queued
  And [UI] No UI path triggers this — covered by API contract test',
'implemented', 'manual', 'Security regression guard for cross-tenant reply attempts.'),

('Get Help admin actions', 32, 'HELP-DESK-032', 'Cache invalidation after admin reply or assign',
'Feature: Get Help admin actions

Scenario: Cache invalidation after admin reply or assign
  Given an admin successfully completes any of reply, assign, close, reopen, or setPrivate
  When the React Query cache settles
  Then [UI] The Open unassigned, Open assigned, and listMine grids all reflect the change on next focus without manual refresh
  And [Code] freescout-proxy called invalidateAll (admin views) and invalidateUser (member-initiated), and React Query keys ["support","admin-all",*] and ["support","mine",*] are invalidated by the success path',
'implemented', 'manual', 'Confirms layered cache invalidation continues to hold after Bug A+B fix.')
ON CONFLICT (scenario_id) DO UPDATE SET
  title = EXCLUDED.title,
  gherkin = EXCLUDED.gherkin,
  status = EXCLUDED.status,
  test_type = EXCLUDED.test_type,
  notes = EXCLUDED.notes,
  updated_at = now();
