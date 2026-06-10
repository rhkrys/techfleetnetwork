INSERT INTO public.bdd_scenarios (scenario_id, feature_area, feature_area_number, title, gherkin, status, test_type) VALUES
('EMAIL-V2-016','Email Subsystem v2',2,'Scheduler fairness: auth before tx before bulk',
'Feature: Email Subsystem v2 Scheduler Fairness
  Scenario: claim_due_emails returns auth rows before bulk when both are pending
    Given the outbox has 5 pending rows in lane=auth and 5 pending rows in lane=bulk all due now
    And the policy maxBatchSize=4
    When public.claim_due_emails(now(), 4) is invoked by the dispatcher
    Then [DB] all 4 returned rows have lane=auth (auth strictly precedes bulk)
    And [Code] FairnessGuard refuses to release the last workspace token to bulk while auth has work waiting
    And [UI] the Email Control Center shows bulk depth unchanged and auth depth dropping after dispatch'
,'implemented','none'),
('EMAIL-V2-017','Email Subsystem v2',2,'Circuit breaker opens after 3 workspace-quota 429s in 10 minutes',
'Feature: Email Subsystem v2 Circuit Breaker
  Scenario: Three 429s in window open the bulk lane circuit
    Given email_lane_state row for lane=bulk has circuit_state=closed
    When the provider returns rate_limited 3 times within 10 minutes on bulk
    Then [Code] applyOutcome transitions state closed -> open with opened_at=now() and probe_at=now()+probeIntervalSec
    And [DB] subsequent calls to claim_due_emails skip lane=bulk until probe_at elapses
    And [UI] the Email Control Center shows lane=bulk circuit badge "Open" with reason="3 rate-limited"
  Scenario: Half-open probe success closes the circuit after 5 sends
    Given email_lane_state for lane=bulk has circuit_state=half_open and consecutive_success=4
    When the next provider call returns sent
    Then [Code] applyOutcome sets circuit_state=closed and consecutive_success=0
    And [DB] the lane resumes normal dispatch
    And [UI] the Email Control Center shows lane=bulk badge return to "Closed"'
,'implemented','none'),
('EMAIL-V2-018','Email Subsystem v2',2,'Idempotency replay returns the original outbox id without duplicating',
'Feature: Email Subsystem v2 Idempotency
  Scenario: Same idempotency_key submitted twice produces one outbox row
    Given EnqueueEmail was called with idempotency_key="welcome-user-42" and produced outbox_id=X
    When EnqueueEmail is called again with the same idempotency_key
    Then [Code] EnqueueEmail short-circuits and returns outbox_id=X with replayed=true
    And [DB] only one row exists in email_outbox for that idempotency_key
    And [UI] the Email Control Center shows a single row, not two'
,'implemented','none'),
('EMAIL-V2-019','Email Subsystem v2',2,'Suppression gate blocks send to a suppressed recipient',
'Feature: Email Subsystem v2 Suppression Gate
  Scenario: Recipient is in suppressed_emails before EnqueueEmail is called
    Given suppressed_emails contains "blocked@example.com" with reason="bounce"
    When EnqueueEmail is called with recipient="blocked@example.com" lane=bulk
    Then [Code] SuppressionGate.check returns blocked=true and EnqueueEmail records status=suppressed
    And [DB] the row is written to email_outbox with status=suppressed and never enters pending
    And [UI] the Email Control Center surfaces the row under Suppressed with reason="bounce"'
,'implemented','none'),
('EMAIL-V2-020','Email Subsystem v2',2,'Frequency cap blocks the 6th bulk email in the rolling window',
'Feature: Email Subsystem v2 Frequency Cap
  Scenario: project-blast cap of 5 per 24h is enforced
    Given recipient "x@y.com" already received 5 bulk emails with template=project-blast in the last 24h
    And the EmailPolicyConfig row has bulk frequencyCap={window:24h, max:5}
    When EnqueueEmail is called with recipient="x@y.com" lane=bulk template=project-blast and no bypass flag
    Then [Code] FrequencyCap.check returns blocked=true with reason="cap_exceeded"
    And [DB] the row is written with status=suppressed and dlq_reason="frequency_cap"
    And [UI] the Email Control Center counts the block under Suppressed (frequency cap) for that template
  Scenario: bypass flag in payload skips the cap
    Given the same recipient at-cap state as above
    When EnqueueEmail is called with payload.bypass_frequency_cap=true
    Then [Code] FrequencyCap.check is skipped
    And [DB] the row is written with status=pending and proceeds normally'
,'implemented','none'),
('EMAIL-V2-021','Email Subsystem v2',2,'ExpireStalePending ages out rows past TTL',
'Feature: Email Subsystem v2 Expire Stale Pending
  Scenario: Pending row older than its lane TTL is marked expired
    Given an email_outbox row in lane=transactional with status=pending created 65 minutes ago
    And the policy ttl.transactional=60 minutes
    When the dispatcher calls outbox.gcExpired()
    Then [DB] the row transitions pending -> expired with dlq_at=now() and dlq_reason="ttl_exceeded"
    And [Code] an ops_events row email.expired is written with lane and template
    And [UI] the Email Control Center shows the row under Expired and the daily rollup increments expired_count'
,'implemented','none'),
('EMAIL-V2-022','Email Subsystem v2',2,'Retention: terminal rows GC after 90 days; audit_log untouched',
'Feature: Email Subsystem v2 Retention
  Scenario: 90-day GC removes sent/dlq/expired/suppressed rows; audit_log compliance trail preserved
    Given email_outbox contains rows with sent_at older than 90 days
    And ops_events for the same idempotency_key are older than 90 days
    When the retention job runs
    Then [DB] email_outbox terminal rows older than 90 days are deleted
    And [DB] ops_events older than 90 days are deleted per existing retention contract
    And [DB] audit_log rows are NOT touched (compliance carve-out)
    And [UI] the Email Control Center continues to render recent data without errors'
,'implemented','none')
ON CONFLICT (scenario_id) DO UPDATE
  SET gherkin = EXCLUDED.gherkin, title = EXCLUDED.title, status = EXCLUDED.status, updated_at = now();