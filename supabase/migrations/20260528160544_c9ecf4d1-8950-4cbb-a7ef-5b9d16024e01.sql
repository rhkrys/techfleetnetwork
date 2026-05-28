with rows(scenario_id, title, gherkin, status, test_type, test_file, notes) as (values
('CI-REG-001', 'Regression workflow runs Vitest on a Node-only runner',
 'Feature: Regression workflow Bun independence
Scenario: Vitest gate executes without Bun on the runner
  Given the regression workflow runs on a fresh ubuntu-latest VM
  When npm run test executes
  Then [Code] the script resolves to vitest run (no bun shim)
  And [UI] the quality job reports green
  And [DB] no agent_fix_queue row with fingerprint ci:Regression:<sha> is inserted',
 'implemented'::bdd_status, 'manual'::bdd_test_type, '.github/workflows/regression.yml', 'Phase 1.'),
('CI-CACHE-001', 'node_modules cache hit skips npm ci',
 'Feature: Two-tier install cache
Scenario: Cached node_modules is reused on lockfile hit
  Given a previous run populated actions/cache for the package-lock.json hash
  When the setup job reaches the cache step
  Then [Code] cache-hit equals true
  And [Code] the install step is skipped
  And [UI] setup wall time is under 60 seconds',
 'implemented'::bdd_status, 'manual'::bdd_test_type, '.github/workflows/regression.yml', 'Phase 2.'),
('CI-SHARE-001', 'Setup job uploads node_modules artifact for downstream jobs',
 'Feature: Install-once share-across-jobs
Scenario: Downstream jobs reuse the setup artifact
  Given setup uploads node_modules.tar.zst
  When quality and playwright jobs start
  Then [Code] each downloads node-modules-<sha>
  And [Code] neither runs npm ci
  And [UI] both start within 30s of setup completion',
 'implemented'::bdd_status, 'manual'::bdd_test_type, '.github/workflows/regression.yml', 'Phase 2.'),
('CI-SHARD-001', 'Playwright sharding splits the fast gate 3 ways',
 'Feature: Playwright sharding
Scenario: Three shards cover the Chromium suite
  Given the playwright job uses matrix shard 1..3
  When the regression workflow runs
  Then [Code] each shard runs npx playwright test --shard=N/3
  And [UI] three playwright shard jobs appear in Actions
  And [UI] total Playwright wall time is below one-third of the unsharded baseline',
 'implemented'::bdd_status, 'manual'::bdd_test_type, '.github/workflows/regression.yml', 'Phase 2.'),
('CI-RETRY-001', 'Transient Playwright install failure recovers on retry',
 'Feature: Retry flaky network steps
Scenario: ECONNRESET during browser install retries
  Given the browser download fails on first attempt
  When the nick-fields/retry wrapper triggers attempt 2
  Then [Code] max_attempts is 3 and timeout_minutes is 8
  And [UI] the workflow succeeds without manual rerun
  And [DB] no agent_fix_queue row is created for the transient failure',
 'implemented'::bdd_status, 'manual'::bdd_test_type, '.github/workflows/regression.yml', 'Phase 3.'),
('CI-GUARD-001', 'Missing pen-test secrets cause clean skip, not red',
 'Feature: Graceful secret guards
Scenario: pentest secrets unset
  Given TF_PENTEST_BASE_URL is not configured
  When the pentest workflow runs
  Then [Code] secrets-guard sets skip=true
  And [Code] the suite step is skipped
  And [UI] the workflow conclusion is success with a warning, not failure',
 'implemented'::bdd_status, 'manual'::bdd_test_type, '.github/workflows/pentest.yml', 'Phase 3.'),
('CI-ALERT-001', 'Red main pushes to agent_fix_queue and Discord',
 'Feature: CI red-alert
Scenario: Regression fails on main
  Given Regression workflow completes with failure on main
  When ci-alert.yml runs via workflow_run
  Then [DB] a row is inserted into public.agent_fix_queue with source=ci, severity=error
  And [Code] discord-notify is POSTed to channel admin-alerts
  And [UI] the failure shows in System Health -> Triage within 5 minutes',
 'implemented'::bdd_status, 'manual'::bdd_test_type, '.github/workflows/ci-alert.yml', 'Phase 3.'),
('BDD-GATE-001', 'PR adding a feature without a scenario fails the gate',
 'Feature: BDD gate
Scenario: New service module without a Gherkin scenario
  Given a PR adds files under src/services/new-thing/
  And no bdd_scenarios row references new-thing
  When bdd-gate.yml runs
  Then [Code] the workflow exits non-zero
  And [UI] GITHUB_STEP_SUMMARY lists the missing module
  And [UI] branch protection blocks merge until a scenario is added',
 'implemented'::bdd_status, 'manual'::bdd_test_type, '.github/workflows/bdd-gate.yml', 'Phase 5.'),
('BDD-COV-001', 'BDD coverage below 80% fails the job',
 'Feature: BDD coverage threshold
Scenario: Implementation rate drops below ratchet
  Given fewer than 80% of bdd_scenarios are implemented
  When scripts/bdd-coverage.ts runs in CI
  Then [Code] it prints a coverage-below-threshold error
  And [Code] it exits non-zero
  And [UI] the quality job is marked failed',
 'implemented'::bdd_status, 'unit'::bdd_test_type, 'scripts/bdd-coverage.ts', 'Phase 5.'),
('CD-PREVIEW-001', 'Every PR receives a Lovable preview URL comment',
 'Feature: PR preview comment
Scenario: PR opened or updated
  Given a contributor opens or pushes to a PR
  When preview-comment.yml runs
  Then [Code] actions/github-script upserts one comment with the lovable-preview-comment marker
  And [UI] the PR shows exactly one preview comment with the Lovable preview URL
  And [Code] subsequent pushes update (not duplicate) the same comment',
 'implemented'::bdd_status, 'manual'::bdd_test_type, '.github/workflows/preview-comment.yml', 'Phase 4.'))
insert into public.bdd_scenarios
  (feature_area, feature_area_number, scenario_id, title, gherkin, status, test_type, test_file, notes)
select 'CI/CD Pipeline',
       2000 + row_number() over (order by scenario_id),
       scenario_id, title, gherkin, status, test_type, test_file, notes
from rows
on conflict (scenario_id) do update
  set title = excluded.title, gherkin = excluded.gherkin, status = excluded.status,
      test_type = excluded.test_type, test_file = excluded.test_file,
      notes = excluded.notes, updated_at = now();