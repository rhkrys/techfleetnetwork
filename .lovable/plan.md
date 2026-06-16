
# Fix the Activity Log "reloads on tab return" — permanently

## What's actually happening (evidence + math)

I read every reload path in the repo and the live page, and traced exactly which ones can fire when you switch tabs and come back to `/admin/activity-log`. There are **two real root causes** still in the code (everything else is already neutralized). Both must be fixed together or the symptom returns.

### Root cause 1 — Focus listeners that touch the network can trigger a remount that destroys page state

Even though our React Query defaults disable `refetchOnWindowFocus`, two surfaces still attach raw `focus`/`visibilitychange` listeners and, on the regain, can either redirect or surface state that React treats as a fresh render path:

- `src/components/MfaEnforcementGuard.tsx:89` — `window.addEventListener("focus", onFocus)` calls `supabase.auth.getSession()` on every tab return. If it gets `needsChallenge` (or, on the cancel branch, line 110) it calls `window.location.replace("/login")`. That is a **full navigation** the user perceives as "the page reloaded itself." This guard is mounted globally inside `AppLayout`, so it runs on `/admin/activity-log` too.
- `src/hooks/use-autosave.ts:217` and `src/hooks/use-server-draft.ts:267` — `visibilitychange` handlers fire a flush on hide. Harmless on their own, but they share the same `tab-becomes-hidden→tab-becomes-visible` cycle that we want to prove is reload-free end-to-end.

### Root cause 2 — Activity Log keeps ALL UI state in `useState`, so any remount = lost place

`src/pages/ActivityLogPage.tsx:150-163` stores `page`, `search`, `eventFilter`, `layerFilter`, `severityFilter`, `dateFrom`, `dateTo` in `useState` only. The AG Grid wrapper itself persists column/sort/filter state per `gridId` (`AgGridImpl.tsx:98-106`), but the page-level filters, the current page index, the search box, and the scroll position are **lost on any remount** — whether triggered by:

- a redeploy (`UpdateAvailableBanner` → user clicks "Refresh now"),
- an `MfaEnforcementGuard` redirect,
- React Suspense re-mount after a chunk retry,
- or even a normal browser refresh.

So even after we kill every silent reload, a user who taps refresh on purpose still loses their place. The permanent fix has to put state somewhere a reload can survive.

### What's already correct (do NOT regress)

- `deploy-watcher.ts:97-101` — no `focus`/`visibilitychange`/`pageshow` listeners; only a 60s poll + `online`. ✅
- `App.tsx:194` and `queryDefaults.ts:38` — `refetchOnWindowFocus: false` globally. ✅
- `use-admin.ts:33-34` — `refetchOnMount:false`, `refetchOnWindowFocus:false`. ✅
- `RouteChangeReloader.tsx` — no reload, only scrollTo. ✅
- `lazy-with-retry.ts` + `index.html` pre-mount handler — chunk reloads are guarded and one-shot. ✅
- `src/test/smoke/no-tab-switch-reload.test.ts` already locks deploy-watcher against focus listeners. ✅ (we'll extend it.)

## The permanent fix

### Phase A — Remove the last focus-driven navigation paths

1. **`MfaEnforcementGuard`**: replace the raw `focus` listener with a Supabase `onAuthStateChange` re-eval that is already wired (lines 66-72 handle `SIGNED_IN`/`TOKEN_REFRESHED`/`USER_UPDATED`). Drop lines 77-94. Result: no MFA gate re-check on tab return → no `/login` replace on tab return. AAL2 elevation is still picked up via `TOKEN_REFRESHED` from the SDK itself.
2. **`MfaEnforcementGuard` cancel branch (line 110)**: change `window.location.replace("/login")` to `navigate("/login", { replace: true })` so the SPA stays mounted and React Query cache is preserved.
3. Add an ESLint rule + smoke test entry that forbids `addEventListener("focus", …)` and `addEventListener("visibilitychange", …)` in any new file under `src/components` and `src/pages` **unless** the file declares `// reason: tab-switch-safe — <justification>` on the line above. `use-autosave.ts`/`use-server-draft.ts` get the marker (they only flush — no navigation, no setState, no reload).

### Phase B — Make Activity Log state survive any reload

4. In `ActivityLogPage.tsx`, replace the seven `useState` calls with a single `useSyncedTableState("activity-log", initial)` hook that:
   - Initializes from `URLSearchParams` first (so the URL is shareable), falls back to `sessionStorage["tfn:activity-log:state"]`, then to defaults.
   - Writes through to both `URLSearchParams` (via `useSearchParams` `replace:true`) and `sessionStorage` on every change, debounced 200ms.
   - Restores **scroll position** on mount from `sessionStorage["tfn:activity-log:scroll"]` (set on `beforeunload` + `visibilitychange:hidden`).
5. Pass `page`, `pageSize`, the active fingerprint/trace, and the current scroll offset through. AG Grid already restores its own column/sort/filter via `useGridState(gridId)` — keep that.
6. Result: a real browser reload, an `UpdateAvailableBanner` refresh, or any remount lands the admin back on the exact same page number, filters, search, and scroll position — by design, not by luck.

### Phase C — Lock the bug class

7. Extend `src/test/smoke/no-tab-switch-reload.test.ts`:
   - Fail if `MfaEnforcementGuard.tsx` re-introduces `addEventListener("focus"`.
   - Fail if any file under `src/pages/` or `src/components/` calls `window.location.reload|replace|assign(` without an inline `// reason:` justification comment.
   - Fail if `ActivityLogPage.tsx` reverts to plain `useState` for `page`/`search`/`eventFilter` (regex: filename + missing `useSyncedTableState`).
8. Add a Playwright regression `e2e/regression/incidents/activity-log-tab-switch.e2e.ts`:
   - Sign in as admin (preview session), go to `/admin/activity-log`, paginate to page 3, filter by `severity=error`, scroll halfway, open a second tab for 5 seconds, return.
   - Assert URL still has `?page=3&severity=error`, filter dropdown still shows "Error", grid scroll offset is within 50 px of where it was, and **no** `pageerror`/full navigation happened.

### Phase D — BDD scenarios (required by project rules)

9. Insert into `bdd_scenarios`:
   - **NO-RELOAD-TAB-001** — tab hide/show on `/admin/activity-log` never fires `location.reload|replace|assign`. [UI] page DOM identity unchanged · [DB] zero new `audit_log` rows with `event_type='session_idle_timeout'` or `'authn_unauthorized'` · [Code] `deploy-watcher.__debug()` shows no extra version check.
   - **NO-RELOAD-TAB-002** — `MfaEnforcementGuard` does not redirect on focus when AAL is satisfied. [UI] route is still `/admin/activity-log` · [DB] no `mfa_challenge_initiated` row · [Code] `onAuthStateChange` is the only re-eval channel.
   - **ACTIVITY-LOG-STATE-001** — page/filter/search/scroll survive a hard reload. [UI] post-reload page index, filter chips, search input, and grid scroll offset match pre-reload · [DB] one read query, no writes · [Code] state hydrated from URL or `sessionStorage`, not from defaults.

## Technical details

### Files touched

- `src/components/MfaEnforcementGuard.tsx` — drop focus listener; switch cancel branch to `useNavigate`.
- `src/pages/ActivityLogPage.tsx` — consume new state hook; restore scroll.
- `src/hooks/use-synced-table-state.ts` — **new**, generic URL+session-backed state hook.
- `src/test/smoke/no-tab-switch-reload.test.ts` — add three guards.
- `e2e/regression/incidents/activity-log-tab-switch.e2e.ts` — **new** Playwright spec.
- `scripts/lint/eslint-plugin-no-focus-listener.mjs` — **new**, marker-comment-enforced rule.
- `eslint.config.js` — register the new rule.
- `supabase/migrations/<ts>_activity_log_no_reload_bdd.sql` — insert the three BDD rows.

### Why this is permanent, not another patch

- The two remaining causes are **structural** (a global focus listener that navigates; component-only state on a long-lived admin grid). Fixing them at the source removes the failure mode entirely.
- The ESLint rule + extended smoke test + Playwright regression mean a future change that re-adds either pattern fails CI before it can ship.
- BDD rows turn the contract into an enforceable, queryable scenario that the BDD gate workflow already checks on every PR touching these files.

### Out of scope (per safety rails)

No auth/account/session/MFA/audit/rate-limit table changes. No RLS edits. No new auth providers. No service workers. No extra clicks for members. AG Grid column/sort/filter persistence is unchanged.
