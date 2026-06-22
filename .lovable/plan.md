
## Why the dashboard always looks like a brand-new user

Two compounding bugs:

1. **No client-side cache persistence.** `src/lib/react-query.ts` re-exports `@tanstack/react-query` with zero persister. Every hard reload starts with an empty in-memory cache, so `useDashboardOverview`, `useCompletedCount`, `useLatestAnnouncements`, and `StatsService.getNetworkStats` all start at `undefined` and refetch over the network before anything renders.

2. **The dashboard renders zeros as truth while loading.** `DashboardPage.tsx` destructures `phaseCounts = {}` and defaults `useCompletedCount` results to `0` before the RPC has resolved. The `coreCourses` array is then computed as "0/N complete" for every course, so the `GettingStartedChecklist` renders "0 of 5 complete" with empty status circles — i.e. the brand-new-user state — on every reload until the network catches up. There is no `isLoading` gate distinguishing "unknown" from "actually zero".

The result: even a returning user with completed onboarding sees the empty checklist for 300–2000 ms on every load (longer when the PostgREST hiccups we patched earlier kick in).

## Fix strategy — server-authoritative, locally hydrated

Server stays the source of truth. The browser caches the last successful snapshot per user and uses it as the **initial paint**, then revalidates in the background and swaps in fresh data when it arrives. Standard SWR pattern.

### Phase 1 — Persist the React Query cache (workspace-wide win)

- Add `@tanstack/query-sync-storage-persister` + `@tanstack/react-query-persist-client`.
- In `src/lib/react-query.ts`, expose a configured `QueryClient` with `gcTime: 24h` and wrap the app with `PersistQueryClientProvider` (replace the current `QueryClientProvider` in `src/App.tsx` / `main.tsx`).
- Persister key namespaced per signed-in `user.id` (`tfn:rq-cache:<uid>`). On sign-out or user switch, the persister is rebuilt with a new key so we never leak one user's snapshot into another's session (critical — we already have `revoked_sessions` and PII rules).
- `buster` key tied to app build hash so deploys invalidate the cache cleanly (pairs with existing `<UpdateAvailableBanner/>`).
- Only persist queries opted-in via `meta: { persist: true }` — start with: `dashboard-overview`, `journey-progress-count:*`, `network-stats`, `latest-announcements`, `dashboard-project-lookup`. Sensitive queries (auth, MFA, admin grace) stay memory-only.

### Phase 2 — Render-gate the dashboard against "unknown vs zero"

In `src/pages/DashboardPage.tsx`:

- Stop defaulting `useCompletedCount` results to `0`. Read them as `number | undefined` and treat `undefined` as "unknown".
- Derive a single `overviewReady` flag = `overview !== undefined && all per-task counts !== undefined`.
- While `!overviewReady` AND no persisted snapshot exists, render the existing `DashboardSkeleton` for the checklist/core-courses section only (header + announcements can still render immediately). When a persisted snapshot exists, render it directly — no skeleton flash.
- The `GettingStartedChecklist` "0 of N complete" copy only shows when we have confirmed-fresh data showing genuine zero progress.

### Phase 3 — Tighten the per-user invalidation seam

- On `auth state change → SIGNED_OUT` (already wired in `AuthContext`), call `queryClient.clear()` AND `persister.removeClient()` so the snapshot is wiped on logout.
- On `SIGNED_IN` with a different `user.id` than the previous snapshot, rebuild the persister with the new key (no cross-user bleed).
- Keep the existing 5-min `refetchInterval` and the 60s adaptive poll in `DashboardPage` — they now act as background revalidation, not initial paint.

### Phase 4 — Tests + BDD (workspace rule: tri-layer Then-clauses)

- Vitest unit: persister namespacing — switching users rebuilds the key and old data is not readable.
- Vitest UI: with a persisted snapshot in `localStorage`, `DashboardPage` first paint shows the snapshot's completed checklist (no "0 of 5" flash) before any network call resolves.
- Vitest UI: with no snapshot and overview pending, the checklist area shows the skeleton, never "0 of 5".
- Insert into `bdd_scenarios`:
  - `DASHBOARD-HYDRATE-001` Returning user opens `/` → checklist renders from persisted snapshot in <100ms with last-known progress; background revalidation updates within 5s. `[UI]` no skeleton flash, `[Code]` persister cache hit, `[DB]` `get_dashboard_overview` called once with `auth.uid()`.
  - `DASHBOARD-HYDRATE-002` First-ever sign-in with no snapshot → skeleton renders, then real checklist. `[UI]` skeleton then data, `[Code]` no `localStorage` entry pre-render, `[DB]` RPC succeeds.
  - `DASHBOARD-HYDRATE-003` User A logs out, user B logs in on same device → user B never sees user A's checklist. `[UI]` only user B's state shown, `[Code]` persister rebuilt with new key, `[DB]` audit_log row for sign-out.

## Files touched

```text
package.json                                    EDIT (add 2 deps)
src/lib/react-query.ts                          EDIT (export QueryClient + persister factory)
src/lib/query/persister.ts                      NEW (namespaced builder, buster, allow-list)
src/App.tsx / src/main.tsx                      EDIT (PersistQueryClientProvider)
src/contexts/AuthContext.tsx                    EDIT (rebuild/clear persister on auth change)
src/hooks/use-dashboard-overview.ts             EDIT (meta.persist=true)
src/hooks/use-journey-progress.ts               EDIT (meta.persist=true, no default 0)
src/hooks/use-announcements.ts                  EDIT (meta.persist=true on latest)
src/services/stats.service.ts (caller)          EDIT (meta.persist=true on network-stats query)
src/pages/DashboardPage.tsx                     EDIT (overviewReady gate, undefined-aware)
src/test/lib/query-persister.test.ts            NEW
src/test/ui/dashboard-hydration.test.tsx        NEW
supabase/migrations/<new>.sql                   NEW (BDD scenarios only)
```

## Out of scope

- No changes to RPCs, RLS, auth, MFA, or any DB schema beyond the BDD-scenarios insert.
- No change to widget visibility prefs (`useDashboardPreferences`) — already DB-backed.
- No service-worker re-enable (existing memory: PWA disabled).

Each phase is independently revertible: Phase 1 adds the engine but is dormant until Phase 2 flips dashboard hooks to `meta.persist`. Phase 2 alone (without 1) still removes the "0 of 5" flash via the skeleton gate.
