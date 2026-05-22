# Fix `/login?_r=…` reload loop

## Root cause (confirmed from `index.html` lines 132-157)

The `?_r=<epoch-ms>` query string is appended by the inline **pre-mount chunk-404 reloader** in `index.html`. It runs when the initial HTML — typically a cached `index.html` served from edge — references a JS/CSS chunk hash that no longer exists on the CDN after a redeploy. The login page is the most common entry URL for un-authed users, which is why this concentrates on `/login`.

The loop happens because the guard against re-reloading is `sessionStorage`-only, with an explicit "fall through and reload anyway" on catch:

```js
try {
  if (sessionStorage.getItem(RELOAD_KEY)) return;
  sessionStorage.setItem(RELOAD_KEY, '1');
} catch (e) { /* fall through */ }     // <-- reloads regardless
```

Users with `sessionStorage` blocked or partitioned (Brave Shields, Safari ITP in iframes/preview, strict corporate proxies, iOS Private mode) hit the catch on every load → reload → same chunk 404 → reload → infinite loop, with `_r` rewriting each cycle.

## Fix

Single small edit to the inline script in `index.html`:

1. **Primary guard = URL presence.** If `location.search` already contains `_r=`, never reload again. This is storage-independent and bounds the recovery to exactly one attempt per navigation, even when storage is blocked.
2. Keep the `sessionStorage` flag as belt-and-suspenders for the (rare) case where the cache-bust survives but a different chunk fails on the next load.
3. Add `_r` to the "ignore our own cache-busted retries" regex on line 137 so a stale URL carrying `_r` cannot re-trip the handler from the asset side.
4. After the app mounts (signalled by `window.__tfnAppMounted`), strip `_r` from the address bar via `history.replaceState` so users don't bookmark/share URLs with the param and don't leave it in referer headers (the existing `setTimeout` on `load` is the natural place).

No other files change. No behaviour change for users with working storage. Users with blocked storage stop looping immediately — they get exactly one recovery reload and then fall through to the normal error path (blank screen → ErrorBoundary → "Try again" surface from `lazy-with-retry.ts`).

## BDD scenarios to add (`bdd_scenarios`, feature_area = login)

- **LCL-LOOP-001** — Pre-mount chunk 404 with working `sessionStorage` → exactly one reload, URL gains `?_r=<ts>` once [UI] AND second pre-mount 404 on the reloaded page does NOT reload [Code].
- **LCL-LOOP-002** — Pre-mount chunk 404 with `sessionStorage.setItem` throwing → exactly one reload still happens, then URL-based guard blocks any further reload [Code] AND user does NOT enter an infinite loop [UI].
- **LCL-LOOP-003** — After successful React mount on `/login?_r=…`, the address bar shows `/login` with the `_r` param stripped [UI] AND `history.length` is unchanged [Code].
- **LCL-LOOP-004** — An asset request whose URL already contains `_r=…` is ignored by the pre-mount handler [Code] AND no reload fires [UI].

## Verification

- Manual: open `/login` in Brave with Shields blocking storage → confirm at most one reload, no loop.
- Manual: open `/login?_r=123` directly → confirm handler does not reload; if mount succeeds the param is stripped from the URL on load.
- Existing chunk-recovery tests under `src/test/lib/` continue to pass (lazyWithRetry is untouched).

## Out of scope

- The deeper question of *why* stale chunks reach users (CDN/edge-cache of `index.html`). That's the deploy-watcher's job and is already mitigated by `src/lib/deploy-watcher.ts`. This plan only stops the loop when a stale chunk does slip through.
