**What happened**
- The backend is currently healthy, and the latest log query I can access did not show a fresh auth outage.
- The prior incident pattern was real: `/token` timeouts and `/user` `bad_jwt` responses during Google login made the app think the session was invalid.
- The app-side amplifier was already fixed: `AuthContext` now trusts a valid stored session on the first transient `bad_jwt` and no longer calls `refreshSession()` from bootstrap.

**Most likely current cause**
- If Gmail login hangs before returning from Google, the likely failure is the managed OAuth token exchange (`/token`) timing out or the preview/proxy path not completing the callback.
- If it returns to `/login`, then the OAuth callback did not produce a usable stored session before `ProtectedRoute` evaluated `user === null`.

**Permanent hardening plan**
1. Add an OAuth callback watchdog to the auth engine so Google sign-in has a bounded “pending callback” state instead of looking logged out while tokens are being consumed.
2. Route OAuth hash/code consumption through the existing auth port/session-safe layer, not direct scattered auth calls.
3. Teach `ProtectedRoute` and `AuthRedirectHandler` to defer redirects while an OAuth callback is pending or being consumed.
4. Add observability for `oauth_start`, `oauth_callback_consumed`, `oauth_callback_timeout`, and `oauth_callback_no_session` with no tokens or PII.
5. Add BDD scenarios in the database for UI, DB, and code/API expected results.
6. Add regression tests/ESLint guardrails proving Google OAuth remains managed-only and no direct legacy OAuth/session paths return.
7. Verify published URL behavior separately from preview so we can distinguish app code from preview proxy issues.

**Receipts after build**
- List exact auth entrypoints and route ownership.
- List old paths removed or guarded.
- Show tests/guards run.
- Confirm no account/profile/session/MFA/rate-limit tables were changed.