# Google OAuth loops back to `/login?from=oauth-canonical`

## What's happening

1. User opens `https://techfleet.network/login` (apex host).
2. They click **Continue with Google**. `GoogleSignInButton` sees `needsCanonicalRestart()` is true on the apex and `window.location.replace`s to `https://www.techfleet.network/login?from=oauth-canonical`.
3. `SignInScreen` reads the `from=oauth-canonical` flag, auto-clicks the Google button on the www host. The Lovable OAuth broker popup runs against www.
4. After the broker round-trip, the user lands back on `https://techfleet.network/login?from=oauth-canonical` (apex), **not www**. Two things make this sticky:
   - The `sessionStorage` guard `tfn:oauth-canonical-restart` only exists on the www origin, so the apex origin has no memory of the previous restart.
   - `GoogleSignInButton` on apex re-evaluates `needsCanonicalRestart()` → true → replaces back to www → SignInScreen auto-clicks → broker → apex again. Infinite loop.

The hostname check + restart hack treats apex and www as two different origins for `sessionStorage`, but the OAuth broker / DNS keeps returning the user to the apex. The "restart on click" logic is the loop generator.

## Root cause

The auth surface is reachable on both `techfleet.network` (apex) and `www.techfleet.network`. OAuth only works on www, but every redirect path that lands on apex (broker error, bookmark, share link, marketing link) re-triggers the click-time restart, which the broker undoes by sending the user back to apex.

The permanent fix is to **never let the user load any page on the apex host**. Canonicalize the host once, at boot, before React mounts — not at click time on a single button.

## Fix (one shipment, no band-aids)

### 1. Boot-time host canonicalization

Add `src/lib/host-canonical.ts`:

- Exports `enforceCanonicalHost()` that runs synchronously in `main.tsx` before `installAuthFetchGuard()`.
- If `window.location.host === "techfleet.network"`, immediately `window.location.replace("https://www.techfleet.network" + pathname + search + hash)` and `throw` to halt boot.
- Skip for `localhost`, `*.lovable.app`, `id-preview--*.lovable.app`, and any host that doesn't match the apex.
- Skip for the OAuth broker callback path (`/~oauth/*`) — Lovable's worker handles those.
- Preserve the full URL (path, query, hash including `#access_token=…`) so any in-flight OAuth callback that lands on apex still completes correctly after the redirect.

Wire it as the very first line inside `src/main.tsx`, before `installAuthFetchGuard()`.

### 2. Retire the click-time restart hack

In `src/components/GoogleSignInButton.tsx`:

- Delete the `needsCanonicalRestart()` branch and the `window.location.replace(\`${canonical}/login?from=oauth-canonical\`)` redirect. With step 1 in place the user can never be on apex when the click handler runs.
- Keep `redirect_uri: getCanonicalOAuthOrigin()` as defense-in-depth.

In `src/features/auth/ui/SignInScreen.tsx`:

- Delete the `from=oauth-canonical` `useEffect` auto-click block and the `CANONICAL_RESTART_KEY` constant. The flag is no longer produced.

### 3. Visual + behavioral safety

- If the boot-time redirect fires, the user just sees the URL bar swap from `techfleet.network` to `www.techfleet.network` and the page render — no flash of the login screen, no popup, no loop.
- Deep links into apex (e.g. `/dashboard`, `/projects/abc`) all canonicalize once at boot.

### 4. Regression locks

- New unit test `src/test/lib/host-canonical.test.ts`:
  - apex → returns the canonical URL with path/query/hash preserved.
  - www → no-op.
  - localhost / `*.lovable.app` → no-op.
  - `/~oauth/callback` on apex → no-op (broker handles it).
- New unit test `src/test/components/google-sign-in.no-restart.test.tsx`:
  - Asserts `GoogleSignInButton` never calls `window.location.replace` and always proceeds straight to `lovable.auth.signInWithOAuth`.
- BDD scenarios inserted into `bdd_scenarios`:
  - `AUTH-OAUTH-APEX-CANONICAL-003` — boot-time canonicalization redirects apex → www preserving path/query/hash. Tri-layer: [UI] no login flash, [Code] `enforceCanonicalHost` returns true with target URL, [DB] `bdd_scenarios` row present.
  - `AUTH-OAUTH-NO-RESTART-LOOP-001` — clicking Google on www never produces a `from=oauth-canonical` URL. Tri-layer: [UI] popup opens directly, [Code] `GoogleSignInButton` has no `needsCanonicalRestart` branch (CI grep), [DB] scenario row present.

### 5. Receipts

After implementing, this turn will report:

- Diff of every file changed (3 prod + 2 tests + 1 migration).
- `bunx vitest run` output on the 2 new test files (red→green proof for the no-restart contract).
- psql confirmation the 2 BDD rows are `implemented`.
- Plain-language note that the apex Google-OAuth loop is closed at the boot layer, not patched at the click layer.

## Files touched

- **New:** `src/lib/host-canonical.ts`
- **Edit:** `src/main.tsx` (one-line wire-up at top)
- **Edit:** `src/components/GoogleSignInButton.tsx` (remove restart branch)
- **Edit:** `src/features/auth/ui/SignInScreen.tsx` (remove auto-click effect + constant)
- **New tests:** `src/test/lib/host-canonical.test.ts`, `src/test/components/google-sign-in.no-restart.test.tsx`
- **New migration:** insert `AUTH-OAUTH-APEX-CANONICAL-003`, `AUTH-OAUTH-NO-RESTART-LOOP-001` into `public.bdd_scenarios`

## Out of scope

- DNS / Lovable hosting config (apex CNAME). Not required: the client-side redirect closes the loop and the apex stays reachable for any non-app traffic.
- Re-architecting `lovable.auth.signInWithOAuth`. The broker is fine on www; the loop was app-side.
