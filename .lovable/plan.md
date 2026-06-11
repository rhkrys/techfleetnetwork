## What is broken

The screenshot is coming from the live legacy `LoginPage` path, not the newer auth state-machine path that was recently added.

That means fixes landed in one auth layer, while the actual member-facing login screen still:

- handles CAPTCHA tokens manually,
- owns its own lockout counters,
- owns its own session-write failure copy,
- calls `AuthService.signInWithPassword()` directly,
- and can leave the member with a consumed/stale Turnstile token after a client session write failure.

The backend evidence supports this:

- Last 7 days: **1,311 Turnstile network failures**, **354 expired CAPTCHA failures**, **48 challenge failures**, **17 widget load blocks**.
- Last 7 days: **12 `jwt_corrupt` fetch-guard recoveries** and **5 `shape_invalid` sign-in failures**.
- The attached auth log shows a `403 bad_jwt` followed by later `/user 200` responses, so the account was safe; the browser session state was dirty.

So the message “Sign-in didn’t complete cleanly” is technically true, but the flow after it is not acceptable: the next click can reuse/lose a CAPTCHA token and then blame the member for verification they cannot complete.

## Re-code plan

### 1. Make the live login page use the single auth engine

Replace the legacy `LoginPage` submit path with the existing auth state-machine flow:

- Use `useAuthMachine("sign_in")` as the only submit coordinator.
- Route all password sign-in through `src/features/auth/flows/sign-in-password.flow.ts`.
- Remove duplicated local login failure attribution from `LoginPage`.
- Keep the existing visual layout, Google button, MFA dialog, and policy links.

Result: one sign-in state machine controls idle, submitting, failed, signed-in, MFA, and retry states.

### 2. Move password login to the brokered, typed result path

Update password sign-in so the UI never receives raw thrown errors from mixed layers:

- Route password sign-in through `auth-broker` / typed `AuthResult` behavior.
- Preserve the server CAPTCHA gate.
- Return stable error codes like `captcha_failed`, `client_session_write_failed`, `invalid_credentials`, `rate_limited`, and `network_error`.
- Ensure `client_session_write_failed` never increments lockout, rate-limit, or CAPTCHA failure counters.

Result: the “Vichea/reset-loop” class of bugs cannot reappear through another legacy path.

### 3. Rebuild CAPTCHA handling as an explicit component state

Refactor `TurnstileChallenge` and login integration so CAPTCHA has its own lifecycle:

- `idle → loading → verified → expired → failed → blocked`
- Always clear a token immediately after any submit attempt, success or failure.
- Force a fresh widget/token after any backend CAPTCHA rejection or session-write failure.
- Show fallback sign-in link when Turnstile is blocked or fails repeatedly.
- Do not increment auth lockout for missing/expired/blocked CAPTCHA.
- Stop showing “complete verification below” unless the widget is actually ready and actionable.

Result: members cannot be stranded by a stale, already-consumed, or invisible verification token.

### 4. Fix password-reset-to-login handoff

After password reset succeeds:

- Clear local auth lockout.
- Clear login CAPTCHA state.
- Clear transient bad-JWT strike state.
- Clear reset attempt state.
- Navigate to login/dashboard with a clean handoff flag.
- Prevent old password-manager autofill from immediately triggering another failed sign-in loop.

Result: the same member who reset their password should get a clean login state, not inherited auth/captcha baggage.

### 5. Replace the bad copy

Replace “Sign-in didn’t complete cleanly” with clearer, member-safe copy:

- Title: “We need to retry sign-in”
- Body: “Your account is safe. Something interrupted the browser session, so we cleared the attempt. Complete verification again and sign in.”
- Recovery: “If this keeps happening, use Google sign-in or request a sign-in link.”

Result: no more confusing “what the hell” message.

### 6. Add regression coverage

Add tests for the exact broken path:

- Session-write failure shows non-punitive retry copy.
- Session-write failure clears CAPTCHA token and remounts verification.
- CAPTCHA failure never increments auth lockout.
- Missing CAPTCHA shows inline guidance only.
- Password reset success clears lockout/captcha/reset-attempt state.
- Google-only account path does not trigger password reset loop.
- A single `bad_jwt` with healthy stored token does not purge; real corrupt storage does purge.

### 7. Add BDD scenarios

Insert/update BDD scenarios covering UI + database + code/API expectations:

- Login retry after client session write failure.
- CAPTCHA blocked fallback path.
- Password reset handoff to clean login state.
- Google-only account recovery path.

### 8. Validate with telemetry

After implementation, verify:

- `login_attempts` no longer records `client_session_write_failed` as invalid credentials.
- CAPTCHA failures do not create failed-login rows.
- `auth_wedge_events` only appears for real corrupt tokens, not ordinary retry flows.
- The login screen can recover from a forced Turnstile failure without page refresh.

## Files I expect to change

- `src/pages/LoginPage.tsx`
- `src/components/auth/TurnstileChallenge.tsx`
- `src/features/auth/flows/sign-in-password.flow.ts`
- `src/features/auth/ui/AuthErrorMessage.tsx`
- `src/services/auth.service.ts`
- `src/lib/auth-captcha.ts`
- `src/lib/auth/session-health.ts` if cleanup hooks need exposure
- Login/reset auth tests
- One BDD scenario migration