## Root cause

Deep dive through `email_send_log`, `audit_log`, `auth_logs`, edge logs and code paths surfaces **one shared root cause** behind every "account issue" report — including the exact error the user pasted (`"We couldn't update your password. Please try again. 2 attempts remaining before you'll need a new link."`):

**Multiple auth-critical edge functions exist in `supabase/functions/<name>/` but have no `[functions.<name>]` block in `supabase/config.toml`. They are silently parked on the CI guard's `BASELINE_DEFAULT_FUNCTIONS` allow-list, so they inherit platform defaults — which today means they do not deploy. They have never booted in production.**

Evidence:
- `update-password-confirmed`: `supabase--edge_function_logs` returns *No logs found* (never booted). Audit table has **zero** `password_update_rejected`, `password_updated`, or `authn_unauthorized` rows from it across 3 days, yet users are clearly hitting "Update password". `supabase.functions.invoke` 404s, supabase-js raises `FunctionsHttpError` with no parseable body, `auth.service.ts` line 453 falls through to the generic message, and `ResetPasswordPage` counts it as a rejection and decrements "attempts remaining" — even though the password and the recovery session were both fine.
- The same allow-list also contains: `login-with-captcha` (email login), `send-magic-link` (magic-link login), `verify-turnstile` (signup captcha), `validate-email-domain` (signup), `resend-signup-confirmations` (signup retry), `sign-out-all-devices` (post-reset cleanup), `revoke-user-sessions`, `delete-account`, plus ~40 ops/admin/cron functions. The auth-critical subset explains the breadth of "signup / email login / magic link / password reset" reports.
- GoTrue itself is clean: 213/213 emails delivered, **zero** 4xx/5xx on `/recover`, `/verify`, `/signup`, `/token`, `/callback` in 3 days. The TypeError + duplicate-enqueue noise from the last 3 days was already permanently fixed. The current outage is the unpinned-function class.
- Google OAuth: no failures observed in `auth_logs`; reports here are almost certainly the same symptom — users falling back to email/password or password reset after one OAuth flake, and getting bricked by the broken `update-password-confirmed` / `login-with-captcha`.

This is the **exact failure mode** documented in `mem://constraints/edge-function-config-pinning` (Get Help / freescout-proxy, June 2026) — the guard exists but the baseline list was used as a parking lot instead of a true zero entry.

## The fix (one shipment, no band-aids)

### 1. Pin every auth-critical edge function and deploy

Add `[functions.<name>]` blocks (with `verify_jwt = true`, since every one of these is called by an authenticated client) to `supabase/config.toml` and remove the same names from the CI guard's `BASELINE_DEFAULT_FUNCTIONS` set:

- `update-password-confirmed`
- `login-with-captcha`
- `send-magic-link`
- `verify-turnstile`
- `validate-email-domain`
- `resend-signup-confirmations`
- `sign-out-all-devices`
- `revoke-user-sessions`
- `delete-account`
- `admin-purge-auth-user`
- `admin-sign-out-all-users`
- `record-consent`, `record-policy-acknowledgment` (gating signup completion)

Deploy all of them in a single `supabase--deploy_edge_functions` call and verify each boots via edge logs.

### 2. Make the client message honest when the function is unreachable

In `src/services/auth.service.ts` (`updatePassword`, and the parallel paths in `signInWithPassword`, `sendMagicLink`, `verifyCaptcha`, `validateEmailDomain`, `resendSignupConfirmation`, `deleteAccount`):

- When `supabase.functions.invoke` errors AND the response body is empty/unparsable OR HTTP status is 404/503, throw a dedicated error with `code: "service_unavailable"`.
- `ResetPasswordPage` (and the matching login / signup pages) treats `service_unavailable` as a non-counting failure: show "We're briefly unable to reach the password service. Please try again in a moment." and **do not** decrement attempts or trip the 3-strike form lock.

### 3. Surface this class of incident immediately, not days later

- In `_shared/request-auth.ts` and `_shared/http.ts`, when an auth-critical fn name returns 404/transport error at the edge gateway, fan out to `agent_fix_queue` with `severity:'error'` and `fingerprint:'edge_function_not_deployed:<fn>'` so the Triage Critical Push cron (5-min) pages admins on the FIRST occurrence. Today the silence makes this invisible.

### 4. Close the guard hole that allowed this

`scripts/ci/check-edge-function-coverage.mjs`:
- Shrink `BASELINE_DEFAULT_FUNCTIONS` to functions that genuinely don't need pinning (cron-only, no client invocation).
- Add a second check: every function imported by `src/` via `supabase.functions.invoke("<name>")` MUST be pinned (no allow-list escape) — string-scan `src/**/*.{ts,tsx}` for invoke names and assert each appears in `config.toml`.
- Fail the CI quality job on either violation.

### 5. Post-deploy verification (in-shipment)

- Curl each pinned function with a bogus token → expect 401 (not 404). Anything that 404s is still not deployed.
- Run a real password-reset flow end-to-end on a test account and confirm a `password_updated` row appears in `audit_log` with the trace id propagated.
- Query `agent_fix_queue` after 10 minutes to confirm no `edge_function_not_deployed:*` events have fired.

### 6. Memory + BDD

- Update `mem://features/auth/password-reset-error-surfacing` with the new `service_unavailable` branch.
- Extend `mem://constraints/edge-function-config-pinning` to spell out the "any function invoked from `src/` must be pinned" rule and the new CI scan.
- Add BDD scenarios AUTH-PIN-001..006 covering: function 404 → friendly message, no attempt decrement, triage page fires once, password reset succeeds end-to-end after pin, login-with-captcha + send-magic-link reachable post-deploy.

## Out of scope

- Email queue / lane / TypeError fixes — already permanently shipped.
- Auth wedge / session revocation behavior — already permanently shipped.
- GoTrue rate-limit fairness — already permanently shipped.

## Expected outcome

The exact paste from the user ("We couldn't update your password…2 attempts remaining…") becomes impossible:
- Either the function now exists and returns a classified message (`same_password`, `weak_password`, `session_expired`, `rate_limited`),
- Or, if the function is ever unreachable again, the UI says "briefly unavailable" without burning attempts, and admins are paged within 5 minutes by the triage push.
