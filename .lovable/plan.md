## What I confirmed in the database (no data loss)

For `mdenner@techfleet.org` (user_id `52ffef70-…82c2`):

- `journey_progress`: **95 rows, all `completed=true`** across all 7 phases (first_steps 11, second_steps 25, third_steps 12, observer 8, project_training 14, volunteer 6, discord_learning 19).
- `course_completions`: **8 rows** — agile-teamwork, project-training, volunteer-teams, discord-learning, connect-discord, onboarding, agile-mindset, observer-course.
- `badges_awarded`: **10 rows**.
- `lesson_catalog`: lesson counts match phase counts 1:1 for every course.
- Last journey write: 2026-05-14. No recent destructive migration. No code change to `journey.service.ts` / `quest.service.ts` / `GenericCoursePage` / step pages in the past 7 days.

**Conclusion:** the regression is not data and not a recent journey/course code change. It is a read-path bug — almost certainly auth identity (recent sign-in refactor) returning a session whose `auth.uid()` no longer matches your `profiles.user_id`, so the RLS-scoped `journey_progress` / `course_completions` SELECTs come back empty and every course renders "not started".

## Fix plan

### 1. Verify the identity mismatch hypothesis (1 query + 1 screenshot)
- Capture from the live preview: the exact `journey_progress` and `course_completions` network responses for the logged-in session (count of rows + status).
- Compare `auth.uid()` reported by the browser session vs `profiles.user_id` for `mdenner@techfleet.org`. If they differ → root cause confirmed.

### 2. Root-cause fix (the right one based on §1)
Two candidates, both shippable in one turn:

- **A. Session identity drift** — the sign-in service refactor must hydrate `profile.user_id` from the SDK session's `user.id`, not from any cached/legacy `profile.id`. Same pattern as the Get Help self-heal: lookup by `user_id`, never by `id`. Audit `useAuth`, `useProfile`, and every `from('journey_progress')`/`from('course_completions')` call site to ensure they use `session.user.id` directly.
- **B. RLS regression** — re-verify `journey_progress` and `course_completions` SELECT policies still resolve `auth.uid() = user_id`. If a recent security migration tightened them, restore correct grants in a follow-up migration.

### 3. Add a permanent guard (no more silent revert)
- New CI check `scripts/ci/check-progress-read-identity.mjs`: every `from('journey_progress'|'course_completions'|'badges_awarded'|'journey_phase_definitions')` must filter by `session.user.id` (or service role), never `profile.id`.
- New SQL smoke test: `select count(*) from journey_progress where user_id = auth.uid()` run as the test member must return > 0 when seeded.
- BDD scenarios `JOURNEY-IDENTITY-001..003` (UI/DB/Code tri-layer) asserting: when a member with completed courses signs in, every previously-completed course renders as done and no row is silently re-created.

### 4. Receipts after ship
- Network capture of `/journey_progress?select=...` returning 95 rows for your session.
- `course_completions` returning 8 rows for your session.
- Curriculum + Journey pages screenshot showing all 8 courses as Completed.
- CI guard green; new BDD scenarios passing.

## What I will NOT touch
- Your data. No upserts, no backfills, no deletes — your 95/8/10 rows stay exactly as they are.
- `auth.users`, `profiles`, `user_roles`, `badges_awarded`, `class_certifications`, `project_certifications` schemas.

## One blocker before I build
I need a 5-second confirmation from the live preview so I fix the right candidate (A vs B) and don't ship a guess: open the Curriculum page while signed in as `mdenner@techfleet.org`, then send me the screenshot + the row counts from the `journey_progress` and `course_completions` requests in the Network tab. If you'd rather I just probe via an admin RPC, I'll add `admin_user_progress_snapshot(p_email)` as part of step 3 and run it myself.
