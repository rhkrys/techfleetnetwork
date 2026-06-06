---
name: Applications Realtime Status Bridge
description: Postgres-changes realtime on project_applications + notifications fallback so applicant_status changes propagate to all open tabs in <3s
type: feature
---
# Realtime applicant-status bridge

## Why
Before: admin moves applicant to invited_to_interview → DB updates correctly,
but client React Query cache (5-min global staleTime, no realtime, no focus
refetch on count badge/dashboard/quest) kept showing "Pending Review" for up
to 5 minutes. A 30s setInterval polled only the currently-mounted Applications
list/status page.

## How (one shipment)
1. `ALTER PUBLICATION supabase_realtime ADD TABLE public.project_applications, public.notifications;` + `REPLICA IDENTITY FULL` on both.
2. `useProjectApplicationsRealtime()` — `postgres_changes` filtered by `user_id=eq.<self>`, invalidates `my-project-applications`, `my-project-apps-count`, `my-project-app-status`, `dashboard-overview`, `quest-roadmap`, `my-active-projects`. Mounted once in `AppLayout` authenticated branch.
3. `useNotificationRealtime()` re-enabled (was no-op "for security" — RLS already scopes to `auth.uid()=user_id`). On INSERT with `type='status_change'` or `applicant_status_*`, runs the same invalidation set as belt-and-suspenders.
4. `staleTime: 60_000` + `refetchOnMount:"always"` + `refetchOnWindowFocus:true` on the four `project_applications`-shaped reads (`MyProjectApplicationsPage`, `ApplicationsPage` count badge, `ProjectApplicationStatusPage`).
5. Deleted both 30s `setInterval` polling blocks — realtime + focus refetch replace them.
6. `notify-applicant-status` magic comment corrected to `// @edge-auth required` and `verify_jwt = true` in `config.toml` (still does its own `getUser` + `has_role` as defense-in-depth). It's an admin-invoked client function, not a cron worker.

## Invariants
- The two channels are RLS-protected. Cross-user leakage is structurally impossible.
- AppLayout authenticated branch is the single mount point. Page-level setIntervals for `project_applications` are forbidden — re-introducing one regresses to the 30s polling era.
- Any new query keyed on `project_applications` MUST set `staleTime ≤ 60_000` + `refetchOnWindowFocus: true`, or join the invalidation set in step 2/3.

## BDD
APP-STATUS-LIVE-001..005 in `bdd_scenarios`.
