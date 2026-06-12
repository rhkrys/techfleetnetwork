## What I confirmed in the database (no data loss)

For `mdenner@techfleet.org` (user_id `52ffef70-…82c2`):

- `journey_progress`: **95 rows, all `completed=true`** across all 7 phases (first_steps 11, second_steps 25, third_steps 12, observer 8, project_training 14, volunteer 6, discord_learning 19).
- `course_completions`: **8 rows** — agile-teamwork, project-training, volunteer-teams, discord-learning, connect-discord, onboarding, agile-mindset, observer-course.
- `badges_awarded`: **10 rows**.
- `lesson_catalog`: lesson counts match phase counts 1:1 for every course.
- Last journey write: 2026-05-14. No recent destructive migration. No code change to `journey.service.ts` / `quest.service.ts` / `GenericCoursePage` / step pages in the past 7 days.

**Conclusion:** the regression is not data and not a recent journey/course code change. It is a read-path bug — almost certainly auth identity (recent sign-in refactor) returning a session whose `auth.uid()` no longer matches your `profiles.user_id`, so the RLS-scoped `journey_progress` / `course_completions` SELECTs come back empty and every course renders "not started".

## Shipped fix

### 1. Verified identity and RLS
- Direct database receipt for `mdenner@techfleet.org`: **95** journey rows, **95** completed rows, **8** course completion rows, **10** badge rows.
- RLS policies verified: `journey_progress` uses `auth.uid() = user_id`; `course_completions` and `badges_awarded` use `auth.uid() = user_id OR admin`.
- Live preview was not signed in, so no authenticated network capture was available from the browser session.

### 2. Root-cause fix
- Confirmed the active journey/course read paths already filter progress by SDK `user.id`, not `profile.id`.
- Fixed the actual remaining gap: `ProgressCacheIdentityGuard` now clears progress, course, quest, and dashboard progress caches on **every** auth transition, including `signed out → signed in` SDK hydration.
- No progress tables were written, backfilled, deleted, or mutated.

### 3. Permanent guard
- `scripts/ci/check-progress-read-identity.mjs` blocks `profile.id` / `currentProfile.id` progress reads.
- `scripts/ci/check-progress-identity-sql-smoke.mjs` calls `member_progress_self_check()` as a signed-in test member when CI provides a test JWT.
- BDD scenarios `JOURNEY-IDENTITY-001..003` are stored in the database with UI/DB/Code expected results.

### 4. Receipts
- `mdenner@techfleet.org`: **95/95** completed journey rows, **8** course completions, **10** badges.
- Progress read guard: green.
- Progress cache regression test: **3/3 passing**.
- SQL smoke hook: wired; skipped locally because no signed-in test-member JWT is configured.

## What I will NOT touch
- Your data. No upserts, no backfills, no deletes — your 95/8/10 rows stay exactly as they are.
- `auth.users`, `profiles`, `user_roles`, `badges_awarded`, `class_certifications`, `project_certifications` schemas.

## Remaining manual receipt
- Sign in as `mdenner@techfleet.org`, open `/courses`, and the guard will force fresh progress reads under the current SDK identity.
