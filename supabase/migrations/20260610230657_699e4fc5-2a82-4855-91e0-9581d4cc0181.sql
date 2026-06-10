
INSERT INTO public.bdd_scenarios (scenario_id, feature_area, feature_area_number, title, gherkin, status) VALUES
('EMAIL-V2-013','email-subsystem-v2',63000,'ProviderPort swap is single-file',$$Feature: Provider port seam
  Scenario: Swapping provider touches only one file
    Given email subsystem v2 ships with LovableEmailsProvider behind ProviderPort
    When an operator implements a ResendProvider against the same ProviderPort
    Then composition.ts is the only file that must change to wire it in
    And [Code] no file under _shared/email/domain/** or _shared/email/application/** imports the provider directly
    And [Code] scripts/ci/check-email-architecture.mjs passes
    And [UI] System Health -> Email v2 lane cards keep rendering with the new provider$$,'not_built'),
('EMAIL-V2-014','email-subsystem-v2',63000,'EventSink dual-writes to ops_events and audit_log',$$Feature: Observability built in
  Scenario: Every dispatch outcome emits a telemetry event
    Given dispatcher claims an outbox row and the provider returns sent
    When DispatchDue records the result
    Then [DB] one row appears in ops_events with kind=email.attempt.sent severity=info
    And [DB] severity=error attempts also append an audit_log row tagged lane:<lane>
    And [Code] both writes share the same trace_id derived from idempotency_key$$,'not_built'),
('EMAIL-V2-015','email-subsystem-v2',63000,'FrequencyCap blocks bulk over-sends per recipient',$$Feature: Per-recipient frequency cap
  Scenario: Bulk lane respects per-recipient cap window
    Given email_policy_config sets bulk frequency cap = 2 per 24h
    And recipient alice@example.com already received 2 bulk emails in the last 24h
    When EnqueueEmail is invoked for alice@example.com on the bulk lane
    Then [DB] the row enters email_outbox with status=suppressed dlq_reason=frequency_cap
    And [DB] ops_events records kind=email.enqueue.frequency_capped
    And [UI] System Health -> Email v2 shows the suppression in the recent activity list$$,'not_built'),
('EMAIL-V2-016','email-subsystem-v2',63000,'GC compacts completed rows past retention',$$Feature: Retention hygiene
  Scenario: gc_expired_email_outbox prunes sent rows older than 90 days
    Given an email_outbox row with status=sent and sent_at < now() - interval 90 days
    When gc_expired_email_outbox() runs
    Then [DB] the row is removed from email_outbox
    And [DB] a rollup is appended to ops_metrics for that day
    And [DB] audit_log is untouched (compliance never pruned in place)$$,'not_built'),
('EMAIL-V2-017','email-subsystem-v2',63000,'Admin Pause and Resume buttons toggle lane state',$$Feature: Operator console controls
  Scenario: Admin pauses then resumes the bulk lane
    Given an admin opens System Health -> Email v2
    When they click Pause on the bulk lane card with reason investigating 429s
    Then [DB] email_lane_state.paused_by_admin=true paused_reason=investigating 429s for lane=bulk
    And [UI] the card status badge shows Paused
    And [Code] dispatcher claim_due_emails returns zero rows for lane=bulk
    When they click Resume bulk lane
    Then [DB] paused_by_admin=false and circuit/cooldown counters are cleared
    And [UI] the badge returns to Closed$$,'not_built'),
('EMAIL-V2-018','email-subsystem-v2',63000,'Manual replay re-enqueues a DLQ row',$$Feature: DLQ replay
  Scenario: Admin replays a single DLQ row
    Given an email_outbox row with status=dlq dlq_reason=max_attempts
    When an admin invokes the v2 console Replay action on it
    Then [DB] the row becomes status=pending attempts=0 next_attempt_at<=now() last_error=null
    And [DB] an audit_log entry records actor=admin kind=email.replay
    And [UI] the row leaves the DLQ list and appears under Pending$$,'not_built'),
('EMAIL-V2-019','email-subsystem-v2',63000,'Force-expire stale pending rows',$$Feature: Stale pending cleanup
  Scenario: Operator force-expires a row past its TTL
    Given an outbox row stuck in status=sending since 30 min ago and lane=auth (TTL 15m)
    When the operator clicks Force-expire
    Then [DB] the row transitions to status=expired with dlq_reason=ttl_exceeded
    And [DB] ops_events emits kind=email.expired severity=warn$$,'not_built'),
('EMAIL-V2-020','email-subsystem-v2',63000,'ESLint no-legacy-email-send blocks direct invokes',$$Feature: Architecture rails
  Scenario: PR adding direct invoke of send-transactional-email fails CI
    Given app code outside allowed paths calls supabase.functions.invoke(send-transactional-email, ...)
    When ESLint runs with the email-v2/no-legacy-email-send rule
    Then [Code] ESLint reports the forbidden message on the call site
    And [Code] CI exits non-zero once the rule is escalated to error at bitmask=7$$,'not_built'),
('EMAIL-V2-021','email-subsystem-v2',63000,'Idempotent enqueue returns the same outbox id on retry',$$Feature: Idempotency contract
  Scenario: Duplicate enqueue with same idempotencyKey returns existing row
    Given EnqueueEmail already created outbox row id=R for idempotencyKey=K
    When EnqueueEmail is invoked again with the same idempotencyKey=K and same recipient
    Then [Code] the use-case returns { id: R, suppressed: false, lane: <same> }
    And [DB] no second row is inserted into email_outbox
    And [DB] ops_events records a single email.enqueued event (no duplicate)$$,'not_built'),
('EMAIL-V2-022','email-subsystem-v2',63000,'Dispatcher rejects requests without service-role auth',$$Feature: Edge function security
  Scenario: Unauthenticated POST to email-dispatcher is rejected
    Given the email-dispatcher edge function is deployed
    When an anonymous request POSTs to /functions/v1/email-dispatcher with no Authorization header
    Then [Code] the response status is 401 with body { error: ... }
    And [DB] no outbox rows are claimed
    And [DB] audit_log records a severity=warn entry for the rejected call$$,'not_built'),
('EMAIL-V2-023','email-subsystem-v2',63000,'Expired rows surface human-readable reason in console',$$Feature: Operator clarity
  Scenario: Expired rows show why they expired
    Given an outbox row with status=expired dlq_reason=ttl_exceeded lane=auth
    When an admin loads System Health -> Email v2
    Then [UI] the row status badge reads Expired and the reason column reads TTL exceeded (auth: 15 min limit)
    And [UI] the row is NOT auto-replayed; the admin must confirm with the user first$$,'not_built'),
('EMAIL-V2-024','email-subsystem-v2',63000,'Decommission gate blocks legacy drop until bitmask=7 + 72h soak',$$Feature: Safe decommission
  Scenario: Attempt to drop process-email-queue before gates pass is blocked
    Given email_send_state.pipeline_v2_lanes_bitmask < 7 OR less than 72h have elapsed since it reached 7
    When CI runs the decommission migration that drops process-email-queue
    Then [Code] the migrations pre-flight check raises decommission_gate_not_met and aborts
    And [DB] no edge functions or pgmq queues are removed
    And [UI] the runbook step Decommission is marked Blocked in docs/runbooks/email-subsystem-v2.md$$,'not_built'),
('EMAIL-V2-025','email-subsystem-v2',63000,'Backfill from email_send_log preserves every in-flight email',$$Feature: Zero-data-loss migration
  Scenario: Phase 2 backfill ingests all pending legacy rows into email_outbox
    Given email_send_log has N rows with status in (pending, sent, dlq) prior to Phase 2
    And pgmq queues q_auth_emails, q_transactional_emails, q_bulk_emails hold M visible messages
    When the Phase 2 backfill migration runs in a single transaction
    Then [DB] count(*) of email_outbox after migration = N + M (deduped by message_id)
    And [DB] every legacy message_id is reachable via email_send_log (now a view) with identical status
    And [Code] downstream queries on email_send_log return the same rows they did pre-migration$$,'not_built')
ON CONFLICT (scenario_id) DO NOTHING;
