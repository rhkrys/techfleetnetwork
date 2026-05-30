
-- Delete the 8 substring suppressions made obsolete by the refactor
DELETE FROM public.known_issue_catalog
WHERE pattern IN (
  'Not authorized for project','code=42501','Recipient already received','TTL exceeded',
  'Push notifications are not ready','service worker is unavailable','use-autosave','Script error.'
);

-- Upsert the 7 BDD scenarios with proper test_file linkage
INSERT INTO public.bdd_scenarios (scenario_id, feature_area, feature_area_number, title, gherkin, status, test_type, test_file) VALUES
('TRIAGE-FIX-001','Error Triage Permanent Fixes',1114,'Roster-gated internal links return empty rows, never 42501',
'Feature: get_project_internal_links roster gate
Scenario: Non-roster member calling get_project_internal_links
  Given an authenticated user who is not on project P''s roster and not an admin
  When the client calls supabase.rpc(''get_project_internal_links'', { p_project_id: P })
  Then [Code] the call resolves without throwing and returns zero rows
  And [UI] MyProjectsTab renders the External Links section as collapsed/absent (no console error)
  And [DB] no row is inserted into agent_fix_queue with event_type=''client_error'' for this call',
'implemented','unit','src/test/smoke/triage-permanent-fixes.smoke.test.ts'),
('TRIAGE-FIX-002','Error Triage Permanent Fixes',1114,'Push subscribe never throws user-facing copy',
'Feature: push subscription failure handling
Scenario: SubscribeResult.message must not be re-thrown
  Given the codebase
  When grep searches for "throw new Error(getSubscriptionFailureMessage"
  Then [Code] zero matches are found
  And [UI] callers branch on SubscribeResult.status and render the message inline
  And [DB] no audit_log row carries ''Push notifications are not ready'' or ''service worker is unavailable'' from a client_error event',
'implemented','unit','src/test/smoke/triage-permanent-fixes.smoke.test.ts'),
('TRIAGE-FIX-003','Error Triage Permanent Fixes',1114,'Frequency-capped emails emit email_capped, not client_error',
'Feature: process-email-queue frequency cap
Scenario: Recipient already over the cap
  Given an enqueued bulk email and a recipient already at the per-recipient cap
  When process-email-queue handles the message
  Then [DB] an audit_log row is written with event_type=''email_capped'' severity=''info''
  And [DB] email_send_log gets a row with status=''frequency_capped''
  And [Code] block_non_actionable_fix_queue_inserts rejects any agent_fix_queue insert with event_type=''email_capped''
  And [UI] System Health > Email tab shows the cap in the guardrail counter',
'implemented','unit','src/test/smoke/triage-permanent-fixes.smoke.test.ts'),
('TRIAGE-FIX-004','Error Triage Permanent Fixes',1114,'DLQ TTL expiry emits email_dlq, not client_error',
'Feature: process-email-queue TTL
Scenario: Queued email exceeds TTL
  Given a message older than the queue TTL
  When the dispatcher processes the batch
  Then [Code] moveToDlq is invoked with eventType=''email_dlq''
  And [DB] discover_audit_fingerprints excludes event_type=''email_dlq'' from agent_fix_queue
  And [UI] the Triage tab is not polluted by the expiry',
'implemented','unit','src/test/smoke/triage-permanent-fixes.smoke.test.ts'),
('TRIAGE-FIX-005','Error Triage Permanent Fixes',1114,'Opaque Script error events stay out of triage',
'Feature: error-reporter opaque-script classifier
Scenario: window.onerror fires Script error from a CORS-blocked script
  Given an ErrorEvent with message=Script error., no error object, no filename, lineno=0, colno=0
  When installGlobalErrorReporter handles the event
  Then [Code] isOpaqueScriptError returns true and writeAudit is not called
  And [DB] no row is appended to audit_log for this event
  And [UI] nothing user-visible changes',
'implemented','unit','src/test/smoke/triage-permanent-fixes.smoke.test.ts'),
('TRIAGE-FIX-006','Error Triage Permanent Fixes',1114,'known_issue_catalog carries zero substring suppressions for refactored sources',
'Feature: catalog hygiene after refactor
Scenario: Catalog contains no entries for the eight refactored patterns
  Given the production known_issue_catalog table
  When we count rows whose pattern is in the refactored list
  Then [DB] the count is zero
  And [Code] error-reporter.service.ts SUPPRESSED_PATTERNS contains none of those eight strings
  And [UI] System Health > Known Issues no longer lists them',
'implemented','unit','src/test/smoke/triage-permanent-fixes.smoke.test.ts'),
('TRIAGE-FIX-007','Error Triage Permanent Fixes',1114,'React Query transient errors do not reach reportError',
'Feature: QueryCache transient error short-circuit
Scenario: Query throws an AbortError (transient)
  Given a QueryClient configured with the project QueryCache onError handler
  When a query fails with an AbortError
  Then [Code] isTransientError returns true and reportError is not invoked
  And [UI] the user sees the standard loading-empty state, not a toast
  And [DB] no audit_log row is written',
'implemented','unit','src/test/smoke/triage-permanent-fixes.smoke.test.ts')
ON CONFLICT (scenario_id) DO UPDATE SET
  feature_area = EXCLUDED.feature_area,
  feature_area_number = EXCLUDED.feature_area_number,
  title = EXCLUDED.title,
  gherkin = EXCLUDED.gherkin,
  status = EXCLUDED.status,
  test_type = EXCLUDED.test_type,
  test_file = EXCLUDED.test_file,
  updated_at = now();
