# Stop the "left my tab, came back, everything reset" reload

## Why it happens

`src/lib/deploy-watcher.ts` runs in every tab. Every 60s (and on `focus` / `online` / `visibilitychange → visible`) it fetches `/version.json` and compares the server's `buildId` to the bundle's `__BUILD_ID__`. When they differ:

- If the tab is **hidden**, it calls `window.location.reload()` immediately (line 104–105).
- If visible, it sets a 30s `scheduleIdleReload` timer that keeps re-checking and reloads as soon as the tab goes hidden (line 79–92).
- `RouteChangeReloader` also reloads at the next route change.

So the normal flow when a deploy lands while your tab is open in the background:
1. You switch to another tab → `visibilitychange → hidden` (or the 30s timer fires).
2. Deploy watcher reloads the page in the background.
3. You return → fresh page, scroll reset, unread badges gone, any draft not yet autosaved is gone.

Drafts that go through `useServerDraft` / `useAutosave` survive (they flush on `visibilitychange → hidden`), but **scroll position, expanded panels, modal state, in-progress form input that hasn't autosaved yet, and any local component state are all lost** — exactly the jarring experience you described.

## Fix: never auto-reload a tab the user is using

Rip out the silent background reload. Replace it with a non-blocking, user-controlled refresh banner. The stale-chunk safety net (`lazyWithRetry`) stays, so the real failure mode the watcher was protecting against (a stale chunk 404 on next lazy import) is still handled — it just doesn't pre-emptively destroy your session anymore.

### Changes

**`src/lib/deploy-watcher.ts`**
- Remove `safeReload()` calls from `checkVersion()` and `scheduleIdleReload()`. Delete `scheduleIdleReload` + `idleTimer` entirely.
- Keep polling and keep flipping `stale = true` + `notify()` so listeners can react.
- Keep `reloadIfStale()` exported (used by the new banner's "Refresh now" button); stop calling it from `RouteChangeReloader`.

**`src/components/RouteChangeReloader.tsx`**
- Remove the `isAppStale()` / `reloadIfStale()` branch. It still scroll-resets and clears the chunk-reload flag on navigation. (Rationale: a user mid-flow who clicks a link does not expect a full page reload either — `lazyWithRetry` handles the rare stale-chunk case.)

**New `src/components/UpdateAvailableBanner.tsx`**
- Subscribes to `onDeployStale`. When stale, renders a small, dismissible toast/banner at the top: copy "A new version is ready." with a verb+object CTA "Refresh now" (calls `reloadIfStale()`) and a "Later" dismiss. Sentence case, brand voice, uses existing `<Card>` / toast tokens. Mount once in `AppLayout` (all 3 branches).
- Banner is sticky until clicked or until a route change to a path that doesn't have an active draft — but it does not auto-reload.

**Keep as-is**
- `lazyWithRetry` (real stale-chunk recovery on navigation only).
- `checkNow()` from the error reporter (still useful to flip `stale=true` faster on a `FunctionsFetchError`).
- React Query defaults — already `refetchOnWindowFocus: false` project-wide, so they are not contributing.

### Tests / BDD

Add to `bdd_scenarios`:
- `DEPLOY-WATCH-001` — Given a new deploy lands while my tab is hidden, when I return to the tab, then [UI] the page is not reloaded, my scroll/draft/modal state is preserved, and a non-blocking "A new version is ready" banner is shown; [Code] `window.location.reload` is not called by deploy-watcher; [DB] no state.
- `DEPLOY-WATCH-002` — Given the update banner is shown, when I click "Refresh now", then [UI] the page reloads to the new build; [Code] `reloadIfStale()` invoked once.
- `DEPLOY-WATCH-003` — Given I am stale and I navigate to a new route, then [UI] the route changes without a full reload and the banner remains visible.

Update `src/test/services/error-reporter.dead-sources.test.ts` only if the existing assertion about `checkNow` still holds (it does; `checkNow` is unchanged).

## Out of scope

- Reload-on-error fallback for actual stale-chunk fetches stays (`lazyWithRetry`).
- No changes to React Query, autosave, or session-activity tracking.
- No service worker changes (already disabled).

## Risk

Strictly less aggressive: the only behavior removed is a silent reload of an idle tab. Worst case after this change is that a user keeps an old bundle running until they manually click Refresh, which is exactly what every other web app does and what the user is asking for.
