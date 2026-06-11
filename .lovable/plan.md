## Root cause

The backend accepted `vtephang@gmail.com` twice at **04:21:28** and **04:21:42**: `login-with-captcha` returned `200 branch=ok`. The failure is **not credentials, not CAPTCHA, not rate limit**.

The app then failed in the browser-only step that writes the returned session into the client auth store, which produced `auth_engine.client_session_write_failed` twice. The current code still does this as a two-step custom auth flow:

```text
login form → edge function verifies CAPTCHA + password → returns raw tokens → browser calls setSessionSafe(tokens)
```

That custom token handoff is the weak link. It creates a session-write failure after the server has already authenticated the member.

## Permanent fix

Refactor email/password sign-in to remove the raw-token handoff entirely.

```text
login form → browser auth SDK signInWithPassword({ email, password, captchaToken }) → session is created by the auth SDK directly
```

This makes the auth SDK the only owner of session creation, instead of asking an edge function to mint tokens and then asking the browser to re-hydrate them.

## Implementation plan

1. **Replace the sign-in path**
   - Update `AuthService.signInWithPassword` to call `supabase.auth.signInWithPassword` directly with the Turnstile token.
   - Keep the existing input validation, activity logging, admin-login audit, MFA gate compatibility, and success marker.
   - Stop calling `login-with-captcha` for password sign-in.

2. **Preserve safety controls without punishing the member**
   - Keep `client_session_write_failed` non-punitive for any remaining SDK/session edge cases.
   - Keep CAPTCHA required before submit.
   - Keep `invalid_credentials` as the only path that increments login counters.
   - Keep existing lockout/rate-limit behavior for real bad-password attempts only.

3. **Move observability to the client-side auth flow**
   - Continue writing `started`, `session_set`, `redirected`, `invalid_credentials`, `network_error`, and `server_error` login events.
   - Add enough typed logging around direct SDK failures so the next incident shows the real SDK code/status instead of generic copy.
   - Add `client_session_write_failed` to the allowed login outcome list so it records correctly when it does happen.

4. **Retire the broken production dependency, not necessarily delete it yet**
   - Leave `login-with-captcha` deployed for rollback/legacy references, but remove it from the active sign-in path.
   - Update comments/tests that currently describe it as the active password-login path.

5. **Regression coverage**
   - Update `src/test/services/auth.service.test.ts` to prove valid email/password + CAPTCHA uses `supabase.auth.signInWithPassword`, not `login-with-captcha`.
   - Add a regression test for the exact Vichea failure: successful SDK sign-in writes `login_succeeded` and does not produce `client_session_write_failed`.
   - Keep contract tests proving `client_session_write_failed` never increments counters.

6. **Database migration**
   - Update `_login_outcome_allowed()` to include `client_session_write_failed`, because the client already emits that outcome but the DB function currently drops it.
   - Add BDD scenarios for:
     - accepted credentials produce a signed-in session without edge-token handoff;
     - SDK session-write errors are non-punitive;
     - `login-with-captcha` is no longer used by the active login form.

## Confidence checks after build

- Query the login trail for `vtephang@gmail.com` again: no new `edge_entered branch=ok` followed by `client_session_write_failed` from the active path.
- Run focused auth tests for `AuthService.signInWithPassword`, auth classifier, and failure policy.
- Verify the auth SDK logs show either clean sign-in or a real provider error code, not the current post-success session-write failure.