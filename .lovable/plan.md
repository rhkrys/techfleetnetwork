# Regression coverage audit + BDD backfill + workflow hardening

## Current state (measured)

**Playwright (regression.yml `playwright` job, 3 shards × 25 min):**
- 13 spec files, 1,449 LOC, chromium-desktop only
- Cancellations seen on shards 1 & 2 are GitHub job-level cancels, not test failures — they hit the 25 min ceiling because `wcag-audit.e2e.ts` (487 LOC) + `responsive-stability` + `profile-setup` dominate one shard, while `auth.e2e.ts` retries 3× per failing test (3 attempts × 60 s = 3 min/test) starve neighbors. No per-shard balancing, no per-test timeout cap, no global hard cap below the job's 25 min.

**BDD scenarios (`bdd_scenarios` table):**
- 1,980 total across 421 feature areas
- Implemented: 1,449 (73%) — but only **92 are `e2e`**, 809 unit, 608 manual
- **Not built: 529** + **test_type=`none`: 452** = ~981 scenarios with zero automated coverage
- Top gap areas: Triage Permanent Refactor (30), General Application (27), Application Analysis (24), Security (22), Accessibility (21), Project Blast (20), Email Deliverability (20), Observer Role Opt-In (19), Email Queue Resilience (18), Notifications (15), CCA (15), i18n-ugc (14), Teacher Role & Classes (14), Form Drafts (13), Privacy & Cookies (12), Brand Voice (12), Network Activity (12), Membership Tiers (12), Step Progress Bar (12), Project Interview Toggle (12)

## Reality check — scope

Building automated coverage for ~981 missing scenarios across 421 feature areas is **not a single-loop task**. A responsible plan ships it in waves so each PR stays reviewable and the regression action stays green. I'll execute every wave back-to-back unless you stop me, but each wave is a discrete shippable unit.

## Wave 0 — workflow hardening (ship first, ~30 min)

Goal: no shard ever hits the 25 min wall again, regardless of how many specs we add later.

1. **`playwright.config.ts`**
   - `timeout: 45_000` per test (default 30 s is too tight for auth flows; cap at 45 to prevent runaway)
   - `expect.timeout: 7_000`
   - `retries: process.env.CI ? 1 : 0` (drop from 2 → 1; cuts worst-case test time by 33%)
   - `workers: process.env.CI ? 2 : undefined` (2 workers/shard on ubuntu-latest 4-core)
   - `globalTimeout: 20 * 60 * 1000` (hard 20 min cap inside the 25 min job ceiling so we get a report instead of a cancel)
   - `reporter: [['html'], ['github'], ['blob']]` — blob reporter enables merged HTML across shards
2. **`regression.yml` `playwright` job**
   - Increase shards from 3 → **6** (still cheap, halves per-shard wall time)
   - `timeout-minutes: 22` (under playwright globalTimeout so artifacts upload)
   - Add `--reporter=blob` and a final `merge-reports` job that downloads all 6 blob artifacts and publishes one HTML report
   - Add `PLAYWRIGHT_JSON_OUTPUT_NAME` and upload `results.json` for downstream agent_fix_queue ingestion
   - Add `if: !cancelled()` to upload step (already has `always()`, fine)
3. **Auth tests** — replace per-test 3× retry with a single `test.describe.configure({ retries: 1 })` block; helpers/`waitForSelector` calls audited for default 30 s timeouts that exceed the new 45 s test cap

## Wave 1 — BDD authoring (no code yet, DB-only)

For each of the **top 20 gap feature areas** above I'll:
1. Read the relevant feature memory + source files
2. Write Gherkin scenarios with tri-layer Then clauses ([UI]/[DB]/[Code]) per project rule
3. Insert into `bdd_scenarios` with `status='not_built'`, `test_type` planned ('e2e'|'unit'|'both'), member + admin paths both covered
4. Target: ~400 new/updated scenario rows; remaining 581 gap rows get pulled forward as wave 2/3 backlog

Coverage matrix per area: happy path (member), happy path (admin), permission denied (anon), permission denied (wrong role), RLS DB assertion, edge-fn auth gate assertion, error recovery, a11y keyboard reach, mobile viewport.

## Wave 2 — e2e implementation (member journeys)

New spec files, one per top area, sharded across the 6 playwright shards:
- `e2e/applications/general-application.e2e.ts`
- `e2e/applications/project-blast-recipient.e2e.ts`
- `e2e/notifications/push-and-inapp.e2e.ts`
- `e2e/i18n/ugc-translation.e2e.ts`
- `e2e/forms/drafts-and-autosave.e2e.ts`
- `e2e/privacy/cookies-and-dsar.e2e.ts`
- `e2e/membership/tiers.e2e.ts`
- `e2e/profile/cca-signing.e2e.ts`
- `e2e/community/observer-role-optin.e2e.ts`
- `e2e/events/week-view.e2e.ts`
- `e2e/classes/teacher-class-lifecycle.e2e.ts`
- `e2e/network/activity-feed.e2e.ts`
- `e2e/projects/interview-toggle.e2e.ts`

Each spec uses the existing `e2e/helpers/` login fixtures, asserts UI + makes a `supabase.from(...).select()` round-trip for the DB-layer Then clause.

## Wave 3 — e2e implementation (admin journeys)

- `e2e/admin/recruiting-center.e2e.ts`
- `e2e/admin/application-analysis.e2e.ts`
- `e2e/admin/project-blast-author.e2e.ts`
- `e2e/admin/triage-queue.e2e.ts`
- `e2e/admin/error-monitoring.e2e.ts`
- `e2e/admin/class-approval.e2e.ts`
- `e2e/admin/announcements-author.e2e.ts`
- `e2e/admin/system-health-tabs.e2e.ts` (Email, Translations, Fleety, Performance, Content, Triage)
- `e2e/admin/promotion-workflow.e2e.ts`
- `e2e/admin/knowledge-ingest.e2e.ts`

Each admin spec asserts at least one negative-auth case (non-admin gets blocked) to keep RLS honest.

## Wave 4 — backend/API/DB-only coverage

Where browser e2e is wrong tool, add Vitest specs that hit Supabase directly:
- `src/test/edge/*.test.ts` for every edge fn lacking JWT/service-role gate test
- `src/test/db/*.test.ts` for RLS matrix per role × table for new tables (i18n_content_registry, ugc_translations, agent_fix_queue, web_vital_samples, cookie_consents, dsar_requests, class_*, project_blasts, observer_role_grants, etc.)
- `src/test/api/circuit-breaker.test.ts`, `src/test/api/rate-limit-fairness.test.ts`

These run inside the existing `quality` job's `npm run test`, no new GH job needed.

## Wave 5 — wire status + verify

1. Run `npx tsx scripts/bdd-coverage.ts` locally, confirm % implemented climbs
2. For every scenario whose test file now exists, flip `bdd_scenarios.status = 'implemented'` + populate `test_file`
3. Push, watch all 6 shards green inside 22 min, merged HTML report attached

## Technical details

- All new specs use `test.describe.configure({ mode: 'parallel' })` so workers fan out
- New specs annotated with `@member` / `@admin` / `@critical` tags so we can filter via `--grep`
- `merge-reports` job uses `npx playwright merge-reports --reporter html ./all-blob-reports` + uploads single artifact
- Shard balance: rely on Playwright's built-in test-id sharding (each test is hashed); no manual partition
- BDD inserts go through the existing migration tool as a single migration per wave (so reviewers can diff scenarios)
- No memory/`mem://` changes needed except a one-line bump to the BDD index after wave 5

## Open decisions before I start

1. **Scope ceiling per loop** — wave 0 + wave 1 in this loop, then I'll continue waves 2–5 in subsequent loops? Or do you want me to attempt all 5 in one go (it will be a very large diff and may exceed practical reviewability)?
2. **Are the 13 admin spec files + 13 member spec files the right cut**, or should I collapse to fewer mega-specs?
3. **Test accounts**: e2e admin journeys need an admin test account. Memory note says "Non-shared testing account guidance; no plaintext credentials." Confirm I should read creds from `E2E_ADMIN_EMAIL` / `E2E_ADMIN_PASSWORD` GitHub secrets (and I'll add them to `regression.yml` env block).
4. **Anything to explicitly exclude** (e.g., Fleety chatbot e2e — flaky against live LLM)?
