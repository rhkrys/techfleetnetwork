# Auth rebuild: one engine, one path, receipts every ship

## Why the same bug keeps coming back (verified, not guessed)

Three independent auth code paths all reach the same screen today. Every fix patched one, the next bug surfaced from another.

Verified file inventory (line counts from the repo right now):

```
568  src/pages/LoginPage.tsx             ← live route /login (legacy path)
521  src/pages/RegisterPage.tsx          ← live route /register (legacy path)
177  src/pages/ForgotPasswordPage.tsx    ← live route /forgot-password
539  src/pages/ResetPasswordPage.tsx     ← live route /reset-password
731  src/services/auth.service.ts        ← throwing legacy service
215  src/lib/auth-error-classifier.ts    ← string-match classifier
122  src/lib/auth-lockout.ts             ← sessionStorage counters
211  src/lib/auth-captcha.ts             ← captcha state in sessionStorage
336  src/components/auth/TurnstileChallenge.tsx
 62  src/features/auth/flows/sign-in-password.flow.ts   ← typed flow (layer 2)
 81  src/features/auth/state/use-auth-machine.ts        ← state machine (layer 3, NOT used by /login)
142  src/features/auth/services/auth-failure-policy.ts  ← the only invariant table (keep)
122  src/features/auth/ui/AuthErrorMessage.tsx          ← keep
345  src/lib/auth/session-health.ts                     ← keep, wedge recovery
```

Importers of the legacy modules (35 files) include `App.tsx`, `LoginPage`, `RegisterPage`, `Forgot/ResetPasswordPage`, `AuthContext`, `SignInForm/SignUpForm/ForgotPasswordForm/ResetPasswordForm`, `EditProfilePage`, `ProfileEditPanel`, plus 7 test files. That sprawl is the bug surface.

Root cause in one sentence: `LoginPage` (and the reset/signup siblings) still own captcha tokens, lockout counters, session-write recovery copy, and call `AuthService` directly — so any fix in the typed flow or the state machine never reaches the screen the member sees.

## Scope guarantee (what does NOT change)

- DB tables, RLS, triggers — untouched. No migrations in ships 1-5.
- `auth.users`, `profiles`, `user_roles`, `revoked_sessions`, `rate_limits`, `login_attempts`, `audit_log`, `bdd_scenarios`, `trusted_devices`, `two_factor_login_sessions`, `device_binding_nonces` — untouched.
- Active sessions stay valid. MFA secrets stay valid. Recovery emails in flight stay valid.
- Google OAuth config, Turnstile site key, edge functions (`update-password-confirmed`, `clear_login_rate_limit_for_email`, `recovery-email`, etc.) — untouched.
- Routes stay the same: `/login`, `/register`, `/forgot-password`, `/reset-password`, `/reset-password/confirm`.
- Visual design preserved: dark card, Tech Fleet logo, Google button on top, email/password below, brand copy, captcha widget in current spot.
- Brand voice + Visual Guide v1 tokens enforced (no raw hex, sentence case, verb+object CTAs).

## New architecture (one engine, three adapters, four screens)

```
src/features/auth/
  engine/
    auth-engine.ts          ← state machine: idle→submitting→mfa→succeeded|failed
    auth-engine.types.ts    ← AuthIntent, AuthOutcome, AuthFailureReason (discriminated union)
    captcha-engine.ts       ← idle→loading→ready→verified|expired|failed|blocked
    failure-policy.ts       ← MOVED from services/auth-failure-policy.ts (invariant table kept)
  ports/
    session.port.ts         ← signInPassword, signInGoogle, signUp, sendReset, finalizeReset, signOut, getUser
    captcha.port.ts         ← mount, reset, getFreshToken, dispose
    telemetry.port.ts       ← record(event, payload) → audit_log/ops_events via existing writer
    rate-limit.port.ts      ← peek, recordFailure, clearForEmail (wraps existing RPCs)
  adapters/
    supabase-session.adapter.ts    ← only file allowed to import @/integrations/supabase/client
    turnstile-captcha.adapter.tsx  ← only file allowed to touch Turnstile SDK / window.turnstile
    audit-telemetry.adapter.ts     ← wraps record_event RPC
    supabase-rate-limit.adapter.ts ← wraps peek_rate_limit / record_rate_limit_failure / clear_login_rate_limit_for_email
  ui/
    SignInScreen.tsx        ← replaces LoginPage (≤180 lines, presentation only)
    SignUpScreen.tsx        ← replaces RegisterPage
    ForgotPasswordScreen.tsx
    ResetPasswordScreen.tsx
    AuthErrorBanner.tsx     ← consumes AuthFailureReason, no string matching
    CaptchaSlot.tsx         ← renders adapter, never touches tokens
```

Hard rules enforced by ESLint (`no-restricted-imports`) and a CI grep guard:

- Screens may import only from `features/auth/engine/*` and `features/auth/ui/*`.
- `engine/*` may import only from `ports/*`. Never from `adapters/*`, never from `@/integrations/supabase/*`, never from `sessionStorage`/`localStorage` directly.
- Only `adapters/supabase-session.adapter.ts` may import the Supabase client.
- Only `adapters/turnstile-captcha.adapter.tsx` may touch `window.turnstile` or render the Turnstile script.
- `AuthService` / `auth-lockout` / `auth-captcha` / `auth-error-classifier` are forbidden imports after Ship 5.

## Behavior contract (locked by tests, not by hope)

1. `client_session_write_failed` → never increments lockout, never increments rate limit, never increments captcha failure count. Copy: "We need to retry sign-in." (Vichea invariant — already covered by `auth-failure-policy.test.ts`, will be re-run against the engine.)
2. `captcha_required` / `captcha_failed` / `captcha_expired` → engine calls `captcha.reset()` and re-mounts a fresh widget without page refresh. Form stays enabled. No stale token survives a failed submit.
3. `invalid_credentials` → increments device lockout, server rate limit, AND captcha failure counter (the three punitive channels), surfaces single banner.
4. `google_only_account` → `suggestReset: false`, banner offers "Continue with Google" only.
5. `session_expired` on reset → banner offers "Request a new reset link", form disabled, no auto-redirect.
6. `weak_password` / `same_password` / `rate_limited` on reset → mapped from edge fn response, never from string matching.
7. Password reset success → calls `clear_login_rate_limit_for_email` AND clears device lockout AND clears captcha soft-reset counter AND clears `tfn:reset-attempts` — one engine call, one place.
8. Transient `bad_jwt` during bootstrap → routed through existing `decidePurgeOnBadJwt` (session-health.ts kept as-is). Never signs out an active member on a single strike.
9. Successful sign-in → engine emits `sign_in_succeeded` once; navigation is the screen's responsibility, not the engine's.

## The 6 ships (each independently revertible, each with a receipt)

### Ship 1 — Engine, ports, adapters (new files only)
- Create everything under `src/features/auth/engine|ports|adapters|ui` listed above.
- Move `auth-failure-policy.ts` → `engine/failure-policy.ts` (re-export shim left behind).
- Zero changes to routes, zero deletions, ESLint guard at `warn` level.
- **Receipt:** new file list, `bun test` green for new engine unit tests (≥25 cases covering the 9 contract items), `rg "from '@/services/auth.service'" src` count unchanged.

### Ship 2 — Replace `/login` with `SignInScreen`
- `App.tsx` line 225 swaps `LoginPage` → `SignInScreen`. `LoginPage.tsx` stays on disk (dead) until Ship 5.
- `SignInScreen` is presentation only. No captcha state, no lockout state, no `AuthService` import.
- All visual elements preserved 1:1 (verified by snapshot test).
- **Receipt:** screenshot diff, `LoginPage.test.tsx` migrated to `SignInScreen.test.tsx`, manual run of the 9 contract items in preview, audit_log shows new `auth_engine.*` events instead of legacy `login_*` events.

### Ship 3 — Replace `/forgot-password` and `/reset-password`
- Swap both routes to new screens.
- `engine.handoffToLogin()` is the single call that clears every counter on successful reset (root cause fix for the "still locked after reset" loop).
- Reset error mapping moves from string-match to edge-function error code (already exposed by `update-password-confirmed`).
- **Receipt:** Forgot/Reset test files migrated, contract test for items 5-7, manual run: force `same_password`, force `session_expired`, force `rate_limited`, force forced-Turnstile-failure mid-reset — all recover without page refresh.

### Ship 4 — Replace `/register` with `SignUpScreen`
- Same pattern. Captcha owned by engine. No direct Supabase calls in the screen.
- **Receipt:** RegisterPage.test migrated, audit_log shows `auth_engine.sign_up_*` only.

### Ship 5 — Delete legacy, flip guard to error
- Delete: `LoginPage.tsx`, `RegisterPage.tsx`, `ForgotPasswordPage.tsx`, `ResetPasswordPage.tsx`, `services/auth.service.ts`, `lib/auth-error-classifier.ts`, `lib/auth-lockout.ts`, `lib/auth-captcha.ts`, `lib/auth-captcha-telemetry.ts`, `components/auth/TurnstileChallenge.tsx`, `components/auth/AuthCaptchaField.tsx`, `features/auth/flows/sign-in-password.flow.ts`, `features/auth/state/use-auth-machine.ts`, `features/auth/state/auth-context.tsx`, `features/auth/ui/SignInForm.tsx` / `SignUpForm.tsx` / `ForgotPasswordForm.tsx` / `ResetPasswordForm.tsx`, duplicate test files (`auth.service.test.ts`, `auth-lockout.test.ts`, `auth-captcha.test.ts`, legacy `LoginPage.test.tsx` etc.).
- Update the 5 non-auth importers (`ProfileEditPanel`, `EditProfilePage`, `AuthContext`, `main.tsx`, `services/index.ts`) to use `session.port` instead of `AuthService`.
- ESLint `no-restricted-imports` flipped to `error`. CI grep guard added: build fails if any of the deleted module names reappear under `src/`.
- **Receipt:** `git diff --stat` showing ~4,000 lines removed, `rg "AuthService|auth-lockout|auth-captcha|auth-error-classifier|TurnstileChallenge|sign-in-password\.flow|use-auth-machine" src` returns zero, full test suite green, build green.

### Ship 6 — Telemetry + BDD lock-in
- New BDD scenarios under tags `AUTH-ENGINE-001..030` covering the 9 contract items + the 3 incident classes that bit us this week (post-reset still-locked, forced Turnstile no-refresh recovery, transient bad_jwt no sign-out).
- `record_event` from `audit-telemetry.adapter` for every state transition, with `severity:info` (won't reach triage).
- 24-hour audit_log diff query saved to `docs/runbooks/auth-rebuild-soak.md`. Pass condition: zero `client_session_write_failed → lockout_incremented` events; zero `reset_succeeded → login_still_locked` events; zero `captcha_failed → page_refresh_required` events.

## Risk register

| Risk | Mitigation |
|---|---|
| Active member sessions break | Zero changes to Supabase client, GoTrue, cookies, or `revoked_sessions`. Verified by importer audit. |
| Recovery email links in flight break | `/reset-password/confirm` route + `update-password-confirmed` edge fn untouched. New screen reads same URL params. |
| MFA flow breaks | `two_factor_login_sessions` table untouched, engine has explicit `mfa` state, contract test MFA-001 covers admin TOTP gate. |
| ESLint guard blocks a legitimate import | Guard scoped to `src/` and to the 9 named modules only. Tests run against engine, not the guard. |
| Ship 5 deletion breaks an unseen caller | Importer scan already done (35 files listed above). 5 non-auth callers explicitly migrated in Ship 5. CI grep guard catches any miss. |
| Rollback needed mid-rebuild | Every ship is one route swap or one file group. Revert = one git revert. DB never touched. |

## What "Done" looks like (no "trust me")

- `wc -l src/pages/*Page.tsx src/services/auth.service.ts src/lib/auth-lockout.ts src/lib/auth-captcha.ts src/lib/auth-error-classifier.ts src/components/auth/TurnstileChallenge.tsx` → "No such file" for all of them.
- `rg "AuthService" src` → zero.
- `App.tsx` routes point to `features/auth/ui/*Screen.tsx`.
- 30 new BDD scenarios green in `bdd_scenarios`.
- 24h post-deploy audit_log diff shows zero occurrences of the three bug classes above.

## Open confirms before Ship 1

1. Same routes (`/login`, `/register`, `/forgot-password`, `/reset-password`, `/reset-password/confirm`) — yes/no.
2. Keep Turnstile as the captcha provider — yes/no.
3. Preserve current visual design exactly (dark card, logo top, Google button above email/password) — yes/no.

Approve and I start Ship 1 immediately.
