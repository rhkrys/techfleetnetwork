Feature: Hand-off production (enqueue + durable async pipeline)
  As an active teammate on a project, once all 26 hand-off components are provided, I
  trigger production. The front door only enqueues; a durable, cron-driven worker drives
  the run to completion with resumable, checkpointed state, then four audience narratives
  are stored for in-app retrieval. (Phase B2.)

  Background:
    Given the handoff-produce endpoint and the handoff-worker are deployed
    And I am signed in

  # ── Functional ──────────────────────────────────────────────────────────────
  Scenario: Producing enqueues and returns immediately
    Given I am an active_participant on project X
    And all 26 components for the phase are provided
    When I request production
    Then a run row is created with status "queued" and I get 202 immediately
    And the durable worker later drives the run to "complete"

  # ── @security — threat model (STRIDE) ────────────────────────────────────────
  @security
  Scenario: A non-member cannot produce a hand-off for a project (Broken access control / IDOR)
    Given I am NOT an active_participant on project X
    When I request production for project X
    Then the request is rejected with 403
    And no run is created for project X
    # Covered by supabase/tests/handoff_rls_idor_test.sql (cross-project isolation).

  @security
  Scenario: Production is blocked until every component is present (Business rule / integrity)
    Given I am an active_participant on project X
    And at least one of the 26 components is missing
    When I request production
    Then the request is rejected with 409 and the completeness gate is returned

  @security
  Scenario: Only one run per project+phase may be in flight (Resource abuse / double-produce)
    Given a run for project X phase is already in progress
    When I request production again for the same project and phase
    Then the request is rejected with 409
    # Enforced by the handoff_productions_one_active partial unique index.

  @security
  Scenario: A repeated "Produce" click is de-duplicated (Idempotency)
    Given I request production with an idempotency key
    When the same idempotency key is submitted again
    Then no second run is created

  @security
  Scenario: The client cannot choose the project owner, status, or model (Mass assignment)
    Given I am an active_participant on project X
    When my request body also contains triggered_by, status, or is_latest fields
    Then those fields are ignored; triggered_by is my authenticated identity and status is server-set

  # ── @reliability — SRE operational readiness ─────────────────────────────────
  @reliability
  Scenario: The kill switch halts new runs AND holds queued ones (queue and hold)
    Given HANDOFF_PRODUCE_DISABLED is set during an LLM outage
    When I request production
    Then the front door returns 503 with a Retry-After and creates no run
    And the worker claims nothing this tick, so already-queued runs are held, not drained
    # Covered by supabase/functions/handoff-produce/ops.test.ts (killSwitchOn predicate).

  @reliability
  Scenario: A degraded story arc completes WITH gaps, never silently
    Given a writer arc fails terminally during a run
    When the run finishes
    Then that arc renders an honest "Awaiting content." placeholder
    And the run records a non-zero gap_count and logs a warning (complete-with-gaps)
    And the run is still marked complete so the reader gets the rest
    # Covered by pipeline-steps.test.ts (runGaps) + the gap_count migration/pgTAP.

  @reliability
  Scenario: A recycled worker resumes a run instead of restarting it
    Given a run is partway through when the worker invocation is recycled
    When the next cron tick claims the run
    Then it continues from the persisted cursor and does not re-run completed units
    And a lease lapse (worker death) is bounded by the crash-recovery attempt cap

  @reliability
  Scenario: LLM spend is metered per run
    When a run makes writer and mechanical model calls
    Then token usage is folded into the shared cost counters under tier "handoff"
    And a cost-meter failure never fails the run

  @reliability
  Scenario: Logs for a run are correlatable
    When any stage of a run logs
    Then the log carries the run's requestId as the queryable trace.id

  # ── @cost — re-create budget (team-wide) ─────────────────────────────────────
  @cost
  Scenario: A team gets one production and one self-service retry per phase
    Given my team has already produced and re-created the hand-offs for this phase
    When anyone on the team requests another production
    Then it is refused (budget_exceeded) with a message to contact an admin
    # Covered by supabase/tests/handoff_run_budget_test.sql.

  @cost
  Scenario: The one retry is writer-only and can target chosen versions
    Given a completed production whose fact base was stored
    When the team re-creates only the Org Case Study
    Then the run is writer_only and scoped to that version
    And it reuses the stored fact base instead of re-extracting (cost control)

  @cost
  Scenario: A double-click cannot burn the retry
    Given two "Produce" requests race for the same project and phase
    Then exactly one run is created and the budget is charged once
    # handoff_enqueue_production checks budget, inserts, and bumps the counter in one transaction.
