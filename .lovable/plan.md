Root cause found: deploy-watcher still checks `/version.json` on `focus` and `visibilitychange`, and context HMR handlers force `window.location.reload()`. On tab switches, those hooks can surface stale deploy state or trigger a full reload during preview/HMR.

Plan:
1. Remove tab-switch deploy checks
   - Stop `startDeployWatcher()` from listening to `window.focus` and `document.visibilitychange`.
   - Keep only a quiet interval/online check that marks the app stale and shows the banner without reloading.

2. Remove forced HMR page reloads from contexts
   - Replace `window.location.reload()` in `AuthContext.tsx` and `PageHeaderContext.tsx` HMR handlers with safe invalidation/state preservation.
   - Keep the globalThis context pinning already implemented so duplicate context bugs stay fixed without nuking the page.

3. Add a no-reload regression test
   - Add/update a smoke test asserting tab visibility/focus handlers do not call `window.location.reload()`.
   - Assert deploy watcher only reloads through the explicit `Refresh now` path.

4. Verify reload sources
   - Re-scan for remaining implicit reload paths and leave only explicit user actions: error-boundary retry buttons, offline retry, and update-banner refresh.