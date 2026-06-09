Root cause:
- The app had two different meanings for "submitted": some old code and database logic still looked for `status='submitted'`, while current submission writes `status='completed'` plus `completed_at`.
- A late draft save could also race a submit, which is why completed rows were able to look like drafts before the last fix.
- The first fix protected general applications only. Project applications still do not have the same database-level invariant, and profile/application counts still rely on status in places instead of the authoritative timestamp.
- There is also no reliable member-facing confirmation email path for application submissions, so people can submit successfully and still get no email.

Permanent fix plan:
1. Make completion impossible to corrupt in the database
   - Add the same invariant trigger to `project_applications` that general applications now has.
   - Strengthen the general application trigger so any row with `completed_at` is always `status='completed'`, not just when a caller writes `draft`.
   - Backfill both tables so any legacy row with `completed_at` is completed.

2. Make the UI use one authoritative completion rule
   - Treat `completed_at IS NOT NULL OR status='completed'` as submitted everywhere member-facing.
   - Fix the Applications page count so “0 apps” cannot appear when a completed timestamp exists.
   - Remove stale `submitted` checks from the member flow where they conflict with `completed`.

3. Stop client-side save races from reappearing
   - Ensure project application autosave/next/back/draft paths never write status.
   - Only the explicit submit action can set `status` and `completed_at`.
   - Verify general application code keeps the same rule.

4. Add a real confirmation email path
   - Add or wire a transactional application-submitted email for general and project applications.
   - Trigger it once from the database/event path when completion first happens, not from fragile client state.
   - Keep Discord/admin notifications non-blocking so email failures do not corrupt submission state.

5. Add regression coverage
   - Add BDD scenarios for the exact failure: submit general app, late autosave arrives, app still counts as submitted; submit project app, profile/applications count updates; confirmation email is queued exactly once.
   - Add tests around the affected UI/service paths so future changes cannot reintroduce status/timestamp drift.

Validation:
- Query the database after migration: zero rows where `completed_at IS NOT NULL AND status <> 'completed'` in both tables.
- Verify member application counts use completed timestamps correctly.
- Verify an application submission queues one confirmation email and does not loop back to the general/project application forms.