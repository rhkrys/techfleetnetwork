with rows(scenario_id, title, gherkin, status, test_type, test_file, notes) as (values
('CI-RERUN-001', 'Regression failure on a flake pattern auto-reruns once',
 'Feature: Auto-rerun on flake
Scenario: ECONNRESET in npm ci triggers one-shot rerun
  Given the Regression workflow finished with conclusion=failure on run_attempt=1
  And at least one failed jobs log contains ECONNRESET / ETIMEDOUT / socket hang up
  When auto-rerun-flake.yml runs via workflow_run
  Then [Code] github.rest.actions.reRunWorkflowFailedJobs is invoked for that run_id
  And [UI] a second attempt appears in the Actions UI within 2 minutes
  And [Code] run_attempt > 1 short-circuits any further auto-rerun (no loops)',
 'implemented'::bdd_status, 'manual'::bdd_test_type, '.github/workflows/auto-rerun-flake.yml', 'Phase 4 — one-shot flake recovery.'),
('BDD-RUN-001', 'BDD scenario runner reports per-area coverage in the quality job summary',
 'Feature: BDD scenario runner (reporting only)
Scenario: Quality job emits a Markdown summary of scenario status by area
  Given the quality job has SUPABASE_URL and SUPABASE_ANON_KEY set
  When node scripts/bdd-scenario-runner.mjs runs
  Then [Code] it fetches all rows from bdd_scenarios via PostgREST
  And [UI] GITHUB_STEP_SUMMARY contains a per-feature-area table with implemented/partial/not_built counts
  And [Code] it exits 0 even on fetch failure (reporting only, no gating in phase 1)',
 'implemented'::bdd_status, 'manual'::bdd_test_type, 'scripts/bdd-scenario-runner.mjs', 'Phase 5 — scenario runner stub.'))
insert into public.bdd_scenarios
  (feature_area, feature_area_number, scenario_id, title, gherkin, status, test_type, test_file, notes)
select 'CI/CD Pipeline',
       2100 + row_number() over (order by scenario_id),
       scenario_id, title, gherkin, status, test_type, test_file, notes
from rows
on conflict (scenario_id) do update
  set title = excluded.title, gherkin = excluded.gherkin, status = excluded.status,
      test_type = excluded.test_type, test_file = excluded.test_file,
      notes = excluded.notes, updated_at = now();