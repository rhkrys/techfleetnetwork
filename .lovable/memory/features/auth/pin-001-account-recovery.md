---
name: AUTH-PIN-001 Account-Recovery Pinning
description: Every supabase.functions.invoke target — especially update-password-confirmed, login-with-captcha, send-magic-link, verify-turnstile, validate-email-domain, sign-out-all-devices, delete-account — MUST be pinned in config.toml. CI guard scans src/ and fails build on any unpinned invoke target. service_unavailable code (404/503/empty body) bypasses 3-strike reset lock.
type: feature
---

## Root cause (2026-06-05)

`update-password-confirmed` (and 26 other client-invoked edge functions) existed locally but had no `[functions.<name>]` block in `supabase/config.toml`. They were parked on the CI guard's `BASELINE_DEFAULT_FUNCTIONS` allow-list. The platform never deployed them. `supabase.functions.invoke` 404'd. supabase-js wrapped it as `FunctionsHttpError` with no parseable body. `auth.service.ts` fell through to the generic "We couldn't update your password" message and `ResetPasswordPage` decremented the 3-strike counter — bricking real users whose password + recovery session were both fine.

Symptom users reported: `"We couldn't update your password. Please try again. 2 attempts remaining before you'll need a new link."`

## Permanent fix shipped

1. All 13 auth-critical functions explicitly pinned in `config.toml` with appropriate `verify_jwt`. All 27 other client-invoked functions also pinned (pin-for-deploy-guarantee).
2. `scripts/ci/check-edge-function-coverage.mjs` now enforces three checks:
   - every `supabase/functions/<name>/` dir is pinned or on a shrunken baseline,
   - every `AUTH_CRITICAL` name MUST be explicitly pinned (no baseline escape),
   - every name passed to `.functions.invoke("<name>")` in `src/` MUST be pinned.
3. `auth.service.ts#updatePassword` classifies HTTP 404/502/503 or empty body as `code:"service_unavailable"` instead of `unknown`.
4. `ResetPasswordPage` treats `service_unavailable` as a non-counting failure: shows "briefly unable to reach the password service" and does NOT decrement attempts or trip the 3-strike lock.

## AUTH_CRITICAL set (never on baseline)
update-password-confirmed, login-with-captcha, send-magic-link, verify-turnstile, validate-email-domain, resend-signup-confirmations, sign-out-all-devices, revoke-user-sessions, delete-account, admin-purge-auth-user, admin-sign-out-all-users, record-consent, record-policy-acknowledgment

## Verification
- `curl /update-password-confirmed` with bogus JWT → `401 UNAUTHORIZED_INVALID_JWT_FORMAT` (function is live; before fix it 404'd).
- CI guard reports `87 edge functions pinned; 46 client-invoked functions all pinned`.
