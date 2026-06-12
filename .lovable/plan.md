## Evidence found

- **Live route ownership:** `src/App.tsx` has `/login` routed to `SignInScreen` at lines 49 and 236.
- **Active login chain:** `SignInScreen` → `useSignInEngine` → `sign-in-password.flow.ts` → currently `AuthService.signInWithPassword` → `supabase.auth.signInWithPassword`.
- **Current active path does not call:** `login-with-captcha`, `setSessionSafe`, or `supabase.auth.setSession` during password login.
- **Remaining risk:** mixed auth ownership still exists: `sign-in-password.flow.ts` imports `AuthService`, `session.port.ts` wraps `AuthService`, and legacy `auth-flow.service.ts` still exposes `setSessionSafe`.
- **Line inventory:** `App.tsx` 319, `SignInScreen.tsx` 164, `use-sign-in-engine.ts` 406, `sign-in-password.flow.ts` 58, `supabase-session.adapter.ts` 89, `auth-flow.service.ts` 81, `auth.service.ts` 723, `auth.service.test.ts` 324, `check-auth-direct-signin.mjs` 36.
- **Trail query blocker:** direct email trail lookup cannot call `_login_hash` from the client because that helper is intentionally permission-restricted.

## Plan

1. **Make the sign-in engine the only login owner**
   - Add password sign-in to `sessionPort` backed by `supabaseSessionAdapter.signInPassword`.
   - Refactor `sign-in-password.flow.ts` to call the port/adapter directly, not `AuthService.signInWithPassword`.
   - Preserve CAPTCHA token passing, result classification, non-punitive `client_session_write_failed`, login success telemetry, MFA handoff, redirects, and admin audit side effects.

2. **Physically remove the old login method from active use**
   - Remove or reduce `AuthService.signInWithPassword` so no active login form can call it.
   - Keep non-login auth functions intact: accounts, profiles, roles, sessions, MFA, audit tables, reset flow, and rate-limit tables stay untouched.
   - Leave `login-with-captcha` deployed only if still needed by legacy references, but CI will prove `/login` cannot call it.

3. **Add guardrails that fail on regression**
   - Strengthen `scripts/ci/check-auth-direct-signin.mjs` to scan the active login flow for:
     - `login-with-captcha`
     - `setSessionSafe`
     - `supabase.auth.setSession`
     - `AuthService.signInWithPassword`
     - direct captcha/lockout storage access outside the approved ports/policy layer
   - Add the guard to the existing package scripts without changing build behavior beyond the explicit check.

4. **Update focused tests**
   - Update auth service tests to stop treating `AuthService.signInWithPassword` as the login owner.
   - Add/adjust tests proving:
     - `/login` flow calls SDK password sign-in through the port/adapter.
     - no `login-with-captcha` or `setSession` path runs after credentials are accepted.
     - `client_session_write_failed` remains non-punitive.
     - classifier and failure policy still map real provider errors cleanly.

5. **Add safe login-trail diagnostics**
   - Add a security-definer admin/service RPC for querying recent login trail rows by email without exposing `_login_hash`.
   - Grant only authenticated admins and service role access through the function body and grants.
   - Add BDD rows with tri-layer Then clauses for the diagnostics and one-engine login invariant.

6. **Validate after build**
   - Run focused auth tests for sign-in, classifier, and failure policy.
   - Run the auth direct-signin guard.
   - Query the new diagnostic RPC for `vtephang@gmail.com` and confirm no new `edge_entered branch=ok` followed by `client_session_write_failed` from the active path.
   - Verify browser/provider logs show either clean SDK sign-in or a real provider error code, not post-success session-write failure.