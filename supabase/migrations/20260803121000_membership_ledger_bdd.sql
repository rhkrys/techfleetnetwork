-- BDD scenarios for the Early Career Membership ledger→projection feature.
-- Executable coverage: CI-run vitest smoke (src/test/smoke/membership-ledger.smoke.test.ts)
-- + pgTAP RLS/logic (supabase/tests/membership_ledger_test.sql, run via `supabase db test`).
-- status='implemented', not 'manual' — these are real, running tests.

INSERT INTO public.bdd_scenarios
  (scenario_id, feature_area, feature_area_number, title, gherkin, status, test_type, test_file, notes)
VALUES
  ('MEM-LEDGER-001', 'Membership', 60,
   'Membership tier is derived from the ledger by a single projector',
   'Feature: Ledger→projection\n  Scenario: The projector is the source of truth\n    Given the gumroad_sales ledger + membership_products catalog\n    When compute_membership(user) runs\n    Then it writes the profile tier and is the only writer',
   'implemented', 'unit', 'src/test/smoke/membership-ledger.smoke.test.ts',
   'compute_membership() derives tier/founding/billing; profiles.membership_* are a cache.'),

  ('MEM-LEDGER-002', 'Membership', 60,
   'Every SECURITY DEFINER function pins an empty search_path',
   'Feature: SQLi/search-path hardening\n  Scenario: definer functions are safe\n    Given every SECURITY DEFINER function\n    Then each pins SET search_path = '''' and fully-qualifies names',
   'implemented', 'unit', 'src/test/smoke/membership-ledger.smoke.test.ts',
   'OWASP SQL Injection / search-path hijack.'),

  ('MEM-LEDGER-003', 'Membership', 60,
   'A member cannot write their own membership tier (column guard)',
   'Feature: Mass-assignment defense\n  Scenario: member PATCHes their tier\n    Given an authenticated member\n    When they set profiles.membership_tier directly\n    Then the guard trigger rejects it (only the projector may write)',
   'implemented', 'both', 'supabase/tests/membership_ledger_test.sql',
   'Guard trigger + app.membership_writer flag; RLS-negative proven in pgTAP.'),

  ('MEM-LEDGER-004', 'Membership', 60,
   'Uncataloged Gumroad products grant no membership',
   'Feature: Catalog gate\n  Scenario: a non-membership product is purchased\n    Given a sale whose product is not in membership_products\n    When compute_membership runs\n    Then the tier stays starter (SETOF lookup excludes it)',
   'implemented', 'both', 'supabase/tests/membership_ledger_test.sql',
   'Tech Fleet sells other Gumroad products; only cataloged ones grant status.'),

  ('MEM-LEDGER-005', 'Membership', 60,
   'Founding is a permanent latch, not revoked by cancellation',
   'Feature: Founding permanence\n  Scenario: a founding member cancels\n    Given a non-refunded, non-disputed founding sale\n    When the subscription is cancelled/ended\n    Then is_founding_member stays true (access may drop to starter)',
   'implemented', 'both', 'supabase/tests/membership_ledger_test.sql',
   'Latch requires not-refunded AND not-disputed; cancellation-proof.'),

  ('MEM-LEDGER-006', 'Membership', 60,
   'Refund / dispute / subscription-end downgrades access',
   'Feature: Lifecycle downgrade\n  Scenario: a paid member is refunded\n    Given an active membership sale\n    When refunded_at/disputed_at/subscription_ended_at is set\n    Then compute_membership drops the tier to starter',
   'implemented', 'both', 'supabase/tests/membership_ledger_test.sql',
   'No refund fraud; access = currently-active sale.'),

  ('MEM-LEDGER-007', 'Membership', 60,
   'Members cannot write the sales ledger',
   'Feature: Ledger RLS\n  Scenario: member inserts a fake sale\n    Given an authenticated member\n    When they INSERT into gumroad_sales\n    Then RLS denies it (only service_role writes)',
   'implemented', 'both', 'supabase/tests/membership_ledger_test.sql',
   'Deny-by-default; proven in pgTAP.'),

  ('MEM-LEDGER-008', 'Membership', 60,
   'Admin reattach is admin-gated and audited',
   'Feature: Orphan reattach\n  Scenario: non-admin calls attach_gumroad_sale\n    Given a non-admin\n    When they call attach_gumroad_sale\n    Then it raises insufficient_privilege; admin calls are audit-logged',
   'implemented', 'both', 'supabase/tests/membership_ledger_test.sql',
   'has_role check inside the definer body.'),

  ('MEM-LEDGER-009', 'Membership', 60,
   'No account has a blank status; drift tripwire audits violations',
   'Feature: Never-blank invariant\n  Scenario: deploy-time backfill\n    Given existing profiles\n    Then every profile is starter or a paid tier\n    And reproject_membership_drift audits any paid profile with no active sale',
   'implemented', 'unit', 'src/test/smoke/membership-ledger.smoke.test.ts',
   'One-time backfill + nightly sweep + membership_invariant_violation tripwire.'),

  ('MEM-LEDGER-010', 'Membership', 60,
   'Webhook is ledger-only with constant-time auth and a body cap',
   'Feature: Webhook ingestion\n  Scenario: a Gumroad Ping arrives\n    Given a valid secret + seller_id\n    Then the sale is recorded (no tier write) and oversized/forged pings are rejected',
   'implemented', 'unit', 'src/test/smoke/membership-ledger.smoke.test.ts',
   'safeEqual, seller_id, body cap on actual bytes, zod validation.'),

  ('MEM-LEDGER-011', 'Membership', 60,
   'Backfill uses verified email, fails closed on unverifiable subscriptions',
   'Feature: Backfill catch-up\n  Scenario: a lapsed member logs in\n    Given a subscription sale whose status cannot be confirmed active\n    Then backfill leaves it pending (no self-restore of access)',
   'implemented', 'unit', 'src/test/smoke/membership-ledger.smoke.test.ts',
   'Subscriber-lifecycle check; verified token email only; no keyword tier.'),

  ('MEM-LEDGER-012', 'Membership', 60,
   'UX: Early Career Membership label, never-blank status, once-per-session backfill',
   'Feature: Membership UX\n  Scenario: member views their plan\n    Then the banner shows a definite status labelled "Early Career Membership" for paid\n    And the Gumroad-API backfill runs at most once per session',
   'implemented', 'unit', 'src/test/smoke/membership-ledger.smoke.test.ts',
   'Config label + session guard + always-definite banner.')
ON CONFLICT (scenario_id) DO UPDATE SET
  title = EXCLUDED.title, gherkin = EXCLUDED.gherkin, status = EXCLUDED.status,
  test_type = EXCLUDED.test_type, test_file = EXCLUDED.test_file,
  notes = EXCLUDED.notes, updated_at = now();
