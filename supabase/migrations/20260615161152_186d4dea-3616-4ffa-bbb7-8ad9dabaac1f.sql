INSERT INTO public.bdd_scenarios (feature_area, feature_area_number, scenario_id, title, gherkin, status, test_type, test_file)
VALUES
  ('Auth architecture cutover', 99, 'AUTH-ARCH-CUTOVER-023',
   'Auth-invariants warn-level violations are snapshot-ratcheted in CI',
   $g$Feature: Auth lint ratchet
  Scenario: Prevent regression of direct supabase.auth.* calls and direct counter mutations
    Given scripts/ci/auth-warn-snapshot.json records the current per-file counts of
          auth-invariants/no-direct-supabase-auth, no-direct-failure-counters, and
          no-auth-storage-literals violations
    When a developer adds a new direct supabase.auth.* call outside src/features/auth/**
      Or increases the violation count in an existing file
    Then [Code] scripts/ci/check-auth-warn-snapshot.mjs exits non-zero and CI fails
     And [UI] no UI change is required — the guard is build-time only
     And [DB] no database write occurs from this guard
    When the legacy surface shrinks (a file's count decreases or reaches zero)
    Then [Code] the developer regenerates the snapshot via --write to lock the new floor
     And [Code] the guard logs a shrink warning until the snapshot is refreshed$g$,
   'implemented', 'manual', 'scripts/ci/check-auth-warn-snapshot.mjs')
ON CONFLICT (scenario_id) DO UPDATE SET
  status = EXCLUDED.status,
  gherkin = EXCLUDED.gherkin,
  test_file = EXCLUDED.test_file,
  updated_at = now();