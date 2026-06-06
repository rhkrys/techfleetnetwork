## Root cause

The DB is being updated correctly — `notify-applicant-status` writes `project_applications.applicant_status` (verified: 71 non-default rows across 4 statuses, last write 2026-06-06 01:46). The bug is purely on the client read path:

- Global React Query `staleTime` is **5 minutes** (`src/App.tsx:155`).
- `MyProjectApplicationsPage` and `ProjectApplicationStatusPage` each have a 30s `setInterval` that calls `invalidateQueries` — but this only runs while that page is mounted.
- `ApplicationsPage`'s count badge (`my-project-apps-count`), `DashboardPage`'s status widget, and `QuestRoadmap` have **no polling and no realtime**, so they show stale `applicant_status` for up to 5 minutes after an admin moves an applicant.
- Realtime was disabled project-wide (`use-notifications.ts:93` "removed for security") even though RLS already scopes `project_applications` to `auth.uid() = user_id` — so the security concern doesn't apply here.
- Net effect: an applicant gets the in-app notification "You've been invited to interview" but the Applications list keeps showing "Pending Review" until they hard-refresh or wait 5 minutes.

## Permanent fix (one shipment)

### 1. Re-enable Realtime on the two tables that drive this UX

Migration: `ALTER PUBLICATION supabase_realtime ADD TABLE public.project_applications, public.notifications;` plus `ALTER TABLE ... REPLICA IDENTITY FULL` on both. RLS already protects row visibility per subscriber.

### 2. New hook `useProjectApplicationsRealtime(userId)`

`src/hooks/use-project-applications-realtime.ts` — subscribes to `postgres_changes` on `public.project_applications` filtered by `user_id=eq.<userId>` and, on any event, invalidates:

- `["my-project-applications", userId]`
- `["my-project-apps-count", userId]`
- `["my-project-app-status", *]`
- `["dashboard-overview", userId]`
- `["quest-roadmap", userId]`

Mount it once inside `AppLayout` (authenticated branch) so every page benefits, not just the list page.

### 3. Notification-bridge fallback in `useNotifications`

Re-enable a minimal `useNotificationRealtime()` (still RLS-scoped to `user_id`). When a new notification with `type` in `{status_change, applicant_status_invited_to_interview, applicant_status_interview_scheduled, applicant_status_active_participant, applicant_status_not_selected, applicant_status_left_the_project}` arrives, run the same invalidation set as #2. This is the belt-and-suspenders path for any tab where the Postgres-changes channel drops (mobile background, network blip).

### 4. Right-size cache windows for `project_applications` reads

Apply `CACHE_USER_MUTABLE` (60s staleTime, already defined in `src/lib/query-config.ts`) + `refetchOnWindowFocus: true` + `refetchOnMount: 'always'` to:

- `useQuery(["my-project-applications", ...])` in `MyProjectApplicationsPage`
- `useQuery(["my-project-apps-count", ...])` in `ApplicationsPage`
- `useQuery(["my-project-app-status", ...])` in `ProjectApplicationStatusPage`
- The `dashboard-overview` and `quest-roadmap` reads that surface `applicant_status`

Delete the two 30s `setInterval` blocks — realtime + focus refetch replace them.

### 5. Fix the misclassified magic comment

`notify-applicant-status/index.ts` was auto-tagged `// @edge-cron` by the recent backfill. It's actually an authenticated client invocation (admin → edge fn → DB write). Change to `// @edge-auth required` and flip `verify_jwt = true` in `config.toml` so the platform validates the JWT before the function runs (the in-function `getUser` + `has_role` check stays as defense-in-depth). This makes 401s loud and triages correctly via the existing `AUTH_CRITICAL` 404 path.

### 6. BDD scenarios `APP-STATUS-LIVE-001..005`

- 001: Admin moves applicant `pending_review` → `invited_to_interview`; within 3s, applicant's open `/applications/projects` tab shows new badge **[UI]**, `project_applications.applicant_status` reflects new value **[DB]**, `auditedInvoke('notify-applicant-status')` returns `200` **[Code]**.
- 002: Same as 001 but applicant's tab is on `/dashboard` — widget updates without manual refresh.
- 003: Realtime channel drops; notification arrives via fallback; invalidation still fires within 1 poll cycle.
- 004: Applicant returns from background (window focus); list refetches and shows latest.
- 005: Non-admin cannot subscribe to other users' `project_applications` rows (RLS denies; subscription returns empty).

### 7. Memory update

Add `mem://features/applications/realtime-status-bridge` describing the realtime + notification-bridge contract and the deleted setInterval polls.

## Out of scope

- Admin-side roster freshness (already uses targeted `invalidateKeys` after the mutation).
- Email/Discord notification delivery (independent path, working today).
- Broader staleTime tuning beyond `project_applications`-shaped queries.

## Expected outcome

When an admin changes an applicant's status, the applicant sees the new badge in every open tab (Applications list, count badge, dashboard widget, quest roadmap, per-application status page) within ~1 second — without polling, without hard-refresh, without the 5-minute stale window.
