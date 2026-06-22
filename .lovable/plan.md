## Root cause

The failing URL `https://techfleet.network/#error=server_error&error_description=failed+to+sign+in+with+vendor&state=…` is the Lovable/Supabase OAuth broker returning a top-level redirect with an error fragment to the **apex** host `techfleet.network`.

Auth logs confirm Google sign-in **succeeds** when initiated from `techfleetnetwork.lovable.app` (one clean `id_token` grant, 200 OK). It only fails when initiated from the apex custom domain. The broker bounces back with `failed to sign in with vendor` and the app silently lands on the logged-out home because nothing in the app reads `window.location.hash` for an OAuth error fragment — it only handles `#access_token=` and `?code=`.

Two compounding problems:

1. **Apex host is not a reliable OAuth origin.** The Lovable OAuth proxy worker requires the exact custom-domain origin to be active. The apex `techfleet.network` is reaching the broker but the vendor exchange fails (origin/redirect mismatch upstream). The `www` host and the `lovable.app` subdomain work.
2. **The error fragment is invisible to the app.** When the broker redirects back with `#error=…`, our root route renders the logged-out home, the hash is left in the URL, and the user has no signal, no toast, no retry path.

## Plan

### Phase 1 — Canonicalize the OAuth origin (prevents the failure)

- Add `src/lib/auth/oauth-origin.ts` exporting `getCanonicalOAuthOrigin()`:
  - If `window.location.host === "techfleet.network"`, return `https://www.techfleet.network`.
  - Otherwise return `window.location.origin`.
  - Pure, unit-tested, no side effects.
- In `GoogleSignInButton.handleClick`, before calling `lovable.auth.signInWithOAuth`:
  - Compute `canonical = getCanonicalOAuthOrigin()`.
  - If `canonical !== window.location.origin`, store the intended post-login redirect (already done) and `window.location.replace(canonical + "/login?from=oauth-canonical")` instead of starting OAuth on the apex. The new page will auto-restart OAuth via a one-shot query flag.
  - Else pass `redirect_uri: canonical` to `lovable.auth.signInWithOAuth` so the broker round-trips through the same working host.
- In `LoginPage` (or wherever `/login` mounts), if `?from=oauth-canonical` is present and the user is unauthenticated, auto-click Google sign-in once (guarded with a sessionStorage one-shot key `tfn:oauth-canonical-restart`).

### Phase 2 — Surface the error fragment (no more silent bounce)

- Add `src/lib/auth/oauth-error-fragment.ts`:
  - `readOAuthErrorFragment(): { error: string; description: string } | null` — parses `window.location.hash` for `error=` + `error_description=` (URL-decoded, `+` → space).
  - `clearOAuthErrorFragment()` — `history.replaceState` to strip the hash without reloading.
- In `AuthRedirectHandler` (top of the tree), on mount and on every route change:
  - If a fragment error is present, call `clearOAuthErrorFragment()`, fire a 30-second top-center error toast ("Google sign-in didn't complete. Please try again."), log a `severity:warn` `oauth_broker_error` audit event via the existing reporter (so it shows in System Health > Login Health), and navigate to `/login?from=oauth-error` (preserving any stored `auth_redirect`).
  - The `?from=oauth-error` page does NOT auto-retry; it just renders normally so the member can click Google again.
- The classifier in `src/lib/login-telemetry.ts` and `LoginHealthTab` already understands `error_description` strings — extend its `KNOWN_OAUTH_BROKER_ERRORS` map to include `failed to sign in with vendor` → human label "Provider exchange failed" so admins can see the trend.

### Phase 3 — Lock the regression

- Tests:
  - `src/test/lib/oauth-origin.test.ts`: `techfleet.network` → `www.techfleet.network`; everything else passes through.
  - `src/test/lib/oauth-error-fragment.test.ts`: parses `#error=server_error&error_description=failed+to+sign+in+with+vendor&state=…`, returns decoded fields, `clear` strips the hash.
  - `src/test/ui/oauth-error-handler.test.tsx`: mount `AuthRedirectHandler` with a mocked location hash, assert toast fires, hash cleared, navigation to `/login?from=oauth-error`.
  - `src/test/ui/GoogleSignInButton.test.tsx`: when host is `techfleet.network`, asserts no broker call and a redirect to `https://www.techfleet.network/login?from=oauth-canonical`.
- ESLint guard (`eslint-rules/no-raw-window-origin-in-oauth.js`): forbid `window.location.origin` inside `GoogleSignInButton.tsx` and `src/integrations/lovable/index.ts` consumers — must go through `getCanonicalOAuthOrigin()`.
- BDD scenarios into `bdd_scenarios` table:
  - `AUTH-OAUTH-APEX-CANONICAL-001` — Google sign-in from apex transparently restarts on `www`.
  - `AUTH-OAUTH-APEX-CANONICAL-002` — Apex restart only fires once per browser tab.
  - `AUTH-OAUTH-ERROR-FRAGMENT-001` — `#error=server_error&error_description=failed+to+sign+in+with+vendor` shows a 30s toast, clears the hash, lands on `/login?from=oauth-error`.
  - `AUTH-OAUTH-ERROR-FRAGMENT-002` — Fragment without `error=` is left untouched (does not interfere with `#access_token=…`).
  - Each scenario carries tri-layer Then-clauses ([UI]/[DB]/[Code]) per workspace rules.

## Out of scope

- No changes to DB schema beyond the `bdd_scenarios` inserts.
- No changes to AuthContext OAuth callback consumer (already implemented in the previous fix).
- No changes to the Lovable OAuth broker config or Google Cloud OAuth client — fix is purely client-side host canonicalization plus visible error handling.
- No re-enabling of the service worker.

Each phase is independently revertible: Phase 1 alone removes the failure for the apex host; Phase 2 alone keeps members from getting silently dropped on the home page when any broker error returns; Phase 3 stops the bug class from regressing.