-- BDD scenarios for the server-side full resync (gumroad-backfill-all) and the
-- membership/Gumroad observability wiring. Executable coverage:
-- src/test/smoke/gumroad-backfill-all-observability.smoke.test.ts (CI vitest).
-- status='implemented' — these are real, running tests.

INSERT INTO public.bdd_scenarios
  (scenario_id, feature_area, feature_area_number, title, gherkin, status, test_type, test_file, notes)
VALUES
  ('MEM-OBS-001', 'Membership', 60,
   'Full membership resync is admin- or cron-only, never callable by members',
   'Feature: Server-side resync authz\n  Scenario: a member calls gumroad-backfill-all\n    Given a non-admin JWT\n    When they invoke gumroad-backfill-all\n    Then it returns 403 and audits authz_admin_denied\n    And a service-role bearer (cron) or admin JWT is required',
   'implemented', 'unit', 'src/test/smoke/gumroad-backfill-all-observability.smoke.test.ts',
   'authorizeServiceRoleRequest (cron) OR has_role admin; no member path.'),

  ('MEM-OBS-002', 'Membership', 60,
   'Resync fails closed on subscriptions it cannot confirm active',
   'Feature: No self-restore via resync\n  Scenario: a lapsed subscription is re-ingested\n    Given a subscription whose status cannot be confirmed active\n    When gumroad-backfill-all runs\n    Then the sale is left pending (no resolved_user_id, no access grant)',
   'implemented', 'unit', 'src/test/smoke/gumroad-backfill-all-observability.smoke.test.ts',
   'fetchSubscriberLifecycle unknown -> grant=false; same fail-closed rule as backfill.'),

  ('MEM-OBS-003', 'Membership', 60,
   'Resync never writes a tier — it projects via the single projector',
   'Feature: Ledger-only resync\n  Scenario: resync ingests sales\n    Given fetched Gumroad sales\n    When gumroad-backfill-all finishes ingest\n    Then it calls reproject_membership_drift and never writes profiles.membership_tier',
   'implemented', 'unit', 'src/test/smoke/gumroad-backfill-all-observability.smoke.test.ts',
   'compute_membership remains the only writer; resync just fills the ledger + projects.'),

  ('MEM-OBS-004', 'Membership', 60,
   'Resync emits lifecycle + failure events with explicit severity',
   'Feature: Resync observability\n  Scenario: resync runs (or fails)\n    Then it emits started/completed (info), misconfigured/api_error/projection_failed (error) and truncated (warn) audit events',
   'implemented', 'unit', 'src/test/smoke/gumroad-backfill-all-observability.smoke.test.ts',
   'auditEdgeEvent with severity info/warn/error; a silent outage is now visible.'),

  ('MEM-OBS-005', 'Membership', 60,
   'Every Gumroad/membership edge failure is audited (no silent 500s)',
   'Feature: Failure visibility\n  Scenario: a persist/reconcile/projection call fails\n    Given webhook, backfill or reconcile hits a DB error\n    Then it emits an auditEdgeEvent (source:edge + severity:error) before returning 500',
   'implemented', 'unit', 'src/test/smoke/gumroad-backfill-all-observability.smoke.test.ts',
   'gumroad_sale_persist_failed / gumroad_reconcile_failed / membership_projection_failed.'),

  ('MEM-OBS-006', 'Membership', 60,
   'The Activity Log labels and classifies every membership/Gumroad event',
   'Feature: Activity Log classification\n  Scenario: an admin opens the Activity Log\n    Then gumroad/membership events show human labels\n    And failures classify as Error and warnings as Warn',
   'implemented', 'unit', 'src/test/smoke/gumroad-backfill-all-observability.smoke.test.ts',
   'EVENT_TYPE_CONFIG labels + inferSeverity (violation/misconfigured=error, truncated=warn).'),

  ('MEM-OBS-007', 'Membership', 60,
   'The membership invariant tripwire carries an explicit severity:error tag',
   'Feature: Tripwire severity\n  Scenario: a paid profile has no active backing sale\n    When reproject_membership_drift sweeps\n    Then it writes membership_invariant_violation tagged severity:error + source:db.membership',
   'implemented', 'unit', 'src/test/smoke/gumroad-backfill-all-observability.smoke.test.ts',
   'Classifies as Error regardless of frontend inference; hardening (definer + pinned search_path) unchanged.'),

  ('MEM-OBS-008', 'Membership', 60,
   'gumroad-backfill-all is pinned in config.toml + the generated manifest',
   'Feature: Edge-function pinning\n  Scenario: the resync function deploys\n    Then supabase/config.toml pins [functions.gumroad-backfill-all] with verify_jwt=false (auth enforced in code)\n    And the coverage generator lists it as a cron function',
   'implemented', 'unit', 'src/test/smoke/gumroad-backfill-all-observability.smoke.test.ts',
   'AUTH-PIN-001: unpinned functions silently stop deploying.'),

  ('MEM-OBS-009', 'Membership', 60,
   'A weekly server-side cron runs the full resync (machine-independent)',
   'Feature: Automatic resync backstop\n  Scenario: the weekly schedule fires\n    Given pg_cron + the Vault service-role secret\n    Then gumroad-backfill-all is invoked every Sunday with no operator machine involved',
   'implemented', 'unit', 'src/test/smoke/gumroad-backfill-all-observability.smoke.test.ts',
   'net.http_post + Vault-secret auth, mirrors the proven cron pattern; backstop to the real-time webhook + login self-heal.')
ON CONFLICT (scenario_id) DO UPDATE SET
  title = EXCLUDED.title, gherkin = EXCLUDED.gherkin, status = EXCLUDED.status,
  test_type = EXCLUDED.test_type, test_file = EXCLUDED.test_file,
  notes = EXCLUDED.notes, updated_at = now();
