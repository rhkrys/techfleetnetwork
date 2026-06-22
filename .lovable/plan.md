## You're right — that UX is broken. Here's the permanent fix.

Today, if Cloud Auth has a hiccup mid-`/signup`, the row gets created server-side but the client sees a generic "timed out" and the user retries forever, eventually hitting `user_repeated_signup` with no path forward. That's the bug. Fixing it everywhere it can happen.

## Root cause

`src/features/auth/services/sign-up.service.ts` and `src/features/auth/flows/sign-up.flow.ts` both treat a 504 / network timeout / "Database error finding user" as a flat failure. They never check whether the row was actually created. There is no "your account may already exist — sign in or reset password" branch. There is no detection of GoTrue's modern `email_exists` / `user_already_exists` error codes (only legacy English substrings).

## Permanent fix (one shipment, no band-aids)

### A. Treat post-timeout signups as indeterminate, not failed
In `sign-up.service.ts` and `sign-up.flow.ts`:

1. On timeout / 5xx / network abort, do NOT throw `Sign-up request timed out`. Instead enter a **resolve-indeterminate** branch:
   - Call `supabase.auth.signInWithPassword({ email, password, captchaToken })` once with a fresh Turnstile token.
   - If it returns `email_not_confirmed` → row exists → route user to "Check your email to verify" screen. Done.
   - If it returns success → row exists and is confirmed → user is signed in. Done.
   - If it returns `invalid_credentials` → row was NOT created → show real retry CTA with the original error.
   - If it returns `email_exists` / `user_already_exists` → route to "This email is already registered — sign in or reset password" with two buttons wired to `/sign-in?email=…` and `/forgot-password?email=…`.
2. While the resolve step runs, the UI shows: *"Checking whether your account was created…"* — not a misleading "timed out."

### B. Code-first duplicate detection (kill the English-substring matching)
Extend `services/auth-classifier.ts` to map GoTrue's `email_exists`, `user_already_exists`, `email_address_already_registered`, and HTTP 422-with-`code:email_exists` to a new `AuthErrorCode.account_exists`. Then both the legacy `signUp` service (line 89) and `sign-up.flow.ts` route off the code, not the message. The substring fallback stays as a last resort.

### C. Surface the "account exists" path everywhere
- `RegisterScreen.tsx` / `SignUpForm.tsx`: on `ACCOUNT_EXISTS` / `account_exists`, render the existing "Sign in instead" + "Reset password" affordances inline (right now it only throws a flat error).
- Same affordance shown from the resolve-indeterminate path in A.

### D. Observability so we catch the next Cloud Auth blip immediately
- `signup_indeterminate_timeout` audit event tagged `severity:warn` whenever the resolve-indeterminate path runs.
- `emitAuthBeacon("auth.signup.indeterminate_resolved", { outcome })` in `auth-telemetry` so the Auth Funnel charts the four resolution outcomes.
- Triage rule already silences `severity:warn`, so this won't flood the queue — it just shows up if it spikes.

### E. Clean up your stranded attempt
Your `mdenner@techfleet.org` row is already confirmed from 2026-03-17. After ship: **sign in** with that email (or use Forgot Password). No new signup needed for that address. No DB change required.

## Guard rails so this can't regress
- New vitest: `sign-up.indeterminate.contract.test.ts` — covers all four resolve-indeterminate outcomes + `email_exists` code.
- New BDD scenarios `SIGNUP-TIMEOUT-PROBE-001..005` in `bdd_scenarios` (tri-layer Then-clauses).
- ESLint `auth-invariants/no-signup-string-match` (warn) — bans `.includes("already registered" | "already been registered" | "user already")` inside auth flows once code-first mapping is in place.

## Out of scope
- Backend infra (Cloud Auth↔DB connectivity) — not in app code.
- No change to the 30s client timeout, captcha, lockout, MFA, or RLS.
- No schema changes.

## Files
```text
src/features/auth/services/sign-up.service.ts          (edit — indeterminate-resolve branch, code-first dup detect)
src/features/auth/flows/sign-up.flow.ts                (edit — same logic on the typed Result path)
src/features/auth/services/auth-classifier.ts          (edit — map email_exists/user_already_exists → account_exists)
src/features/auth/domain/auth-codes.ts                 (edit — add account_exists if missing)
src/features/auth/ui/SignUpForm.tsx                    (edit — inline "Sign in / Reset" affordance on account_exists)
src/features/auth/ui/RegisterScreen.tsx                (edit — interim "Checking…" copy + route on resolve outcome)
src/features/auth/services/auth-telemetry.ts           (edit — indeterminate_resolved beacon kind)
src/test/features/auth/sign-up.indeterminate.contract.test.ts   (new)
scripts/lint/eslint-plugin-auth-invariants.mjs         (edit — no-signup-string-match rule)
public.bdd_scenarios                                   (data — SIGNUP-TIMEOUT-PROBE-001..005)
```
