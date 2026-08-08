-- BDD for Wave-0 CI/DR remediation (audit H3+H4): the DB must be rebuildable
-- from migrations, and CI must enforce it. Executable coverage: the (now
-- re-enabled, blocking) `migration-smoke` job in .github/workflows/ci.yml runs
-- `supabase db reset` on every migration-touching PR.

INSERT INTO public.bdd_scenarios
  (scenario_id, feature_area, feature_area_number, title, gherkin, status, test_type, test_file, notes)
VALUES
  ('OPS-DBRESET-001', 'Reliability', 91,
   'The database rebuilds cleanly from migrations, enforced in CI',
   'Feature: Rebuildable-from-source database (DR + cutover prerequisite)\n  Scenario: a fresh reset applies the full history\n    Given a clean Postgres and the tracked migration history\n    When supabase db reset runs\n    Then every migration applies in order with no error\n    And try_write_audit_log exists before it is first REVOKE-d (repair 20260430021349)\n    And the placeholder your_audit_function_name REVOKE is satisfied then cleaned up (20260430021351)\n  Scenario: CI blocks a migration that does not apply from scratch\n    Given a PR that touches supabase/migrations\n    When the migration-smoke job runs db reset\n    Then a non-applying migration fails the required gate (no continue-on-error, no skip-as-pass loophole)',
   'implemented', 'unit', '.github/workflows/ci.yml',
   'H3: try_write_audit_log had no CREATE in migrations (Lovable-era) -> db reset died at the 20260430 REVOKE. H4: migration-smoke was hard-disabled (&& false) and the gate treated skip as pass, so no migration/RLS change was ever executed before merge. Now blocking. Remaining Lovable-era db-reset gaps (if any) are driven to green via CI iteration since db reset cannot run locally without Docker.')
ON CONFLICT (scenario_id) DO UPDATE SET
  title = EXCLUDED.title, gherkin = EXCLUDED.gherkin, status = EXCLUDED.status,
  test_type = EXCLUDED.test_type, test_file = EXCLUDED.test_file,
  feature_area = EXCLUDED.feature_area, feature_area_number = EXCLUDED.feature_area_number,
  notes = EXCLUDED.notes, updated_at = now();
