## Diagnosis

Login is failing because the OAuth callback is not owned by one reliable consumer:

- The installed Lovable auth helper intentionally opens/redirects through `~oauth/initiate`; on published pages it can be a full-page redirect, in preview it should use a popup/web-message path.
- The app disables automatic URL session detection, but `AuthContext` only consumes hash-token callbacks, not `?code=` callbacks.
- A leftover guard in `session.service.ts` still treats a root `?code=` callback without a fresh local marker as invalid, strips the URL, clears auth state, and returns the member to the logged-out home page.
- Auth logs also show `/token` timeouts during the failing attempts; hosted backend is healthy now, but the client must not purge local auth state on one transient token-exchange failure.

## Plan

1. **Create one OAuth callback owner**
   - Add a dedicated auth callback consumer service used by `AuthContext` before normal session bootstrap.
   - It will handle both callback shapes:
     - `?code=...` via the existing session port code-exchange method.
     - `#access_token=...&refresh_token=...` via the existing session restore method.
   - It will preserve the saved redirect target and navigate to `/dashboard` or the intended route only after a real session exists.

2. **Remove the stale purge path**
   - Delete the root-callback “no UI marker = clear auth” behavior from `session.service.ts`.
   - Keep CSRF/state validation delegated to the managed auth broker/backend instead of local fragile storage markers.
   - Keep the marker only as a UX hint for redirect deferral, never as authority to destroy a session.

3. **Harden transient failure handling**
   - If code exchange/token restore fails with a backend timeout or temporary network failure, do not clear auth storage.
   - Show a 30-second top-center error with plain recovery copy and leave the user on `/login` or the callback page safely.
   - Only purge on proven invalid/expired local tokens through the existing two-strike session-health gate.

4. **Normalize redirect behavior**
   - Make Google sign-in store a safe intended destination before starting OAuth.
   - After successful callback consumption, `AuthRedirectHandler` sends the member to the stored destination or `/dashboard`.
   - Ensure `/` with an authenticated session never renders the logged-out home first; it redirects after auth settles.

5. **Add regression coverage + BDD**
   - Add tests proving:
     - `/?code=...&state=...` is exchanged and does not clear local auth.
     - Missing UI marker no longer signs a valid OAuth callback out.
     - A transient token timeout does not purge a valid stored session.
     - Successful Google callback lands on `/dashboard` or the saved route.
   - Add/update BDD scenarios in the database with UI, DB, and code expected results.

## Verification receipts after build

- List remaining auth entrypoints and prove Google login has one start path and one callback path.
- Run targeted auth regression tests.
- Check fresh auth logs for the same callback-loop signature.
- Verify the dashboard route is reached after callback consumption.