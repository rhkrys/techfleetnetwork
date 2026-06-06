---
name: AUTH-PIN-001 Account-Recovery Pinning
description: Every supabase.functions.invoke target — especially login-with-captcha, send-magic-link, verify-turnstile, validate-email-domain, sign-out-all-devices, delete-account — MUST be pinned in config.toml. CI guard scans src/ and fails build on any unpinned invoke target. Password reset completion must not depend on an extra edge function.
type: feature
---

## Root cause (2026-06-05)

`update-password-confirmed` (and 26 other client-invoked edge functions) existed locally but had no `[functions.<name>]` block in `supabase/config.toml`. They were parked on the CI guard's `BASELINE_DEFAULT_FUNCTIONS` allow-list. The platform never deployed them. `supabase.functions.invoke` 404'd. supabase-js wrapped it as `FunctionsHttpError` with no parseable body. `auth.service.ts` fell through to the generic "We couldn't update your password" message and `ResetPasswordPage` decremented the 3-strike counter — bricking real users whose password + recovery session were both fine.

Follow-up fix (2026-06-06): `update-password-confirmed` is retired. Password reset completion now uses `supabase.auth.updateUser({ password })` directly from the verified recovery session, with edge-dependent cleanup best-effort only.

Symptom users reported: `"We couldn't update your password. Please try again. 2 attempts remaining before you'll need a new link."`

## Permanent fix shipped

1. All 13 auth-critical functions explicitly pinned in `config.toml` with appropriate `verify_jwt`. All 27 other client-invoked functions also pinned (pin-for-deploy-guarantee).
2. `scripts/ci/check-edge-function-coverage.mjs` now enforces three checks:
   - every `supabase/functions/<name>/` dir is pinned or on a shrunken baseline,
   - every `AUTH_CRITICAL` name MUST be explicitly pinned (no baseline escape),
   - every name passed to `.functions.invoke("<name>")` in `src/` MUST be pinned.
3. `auth.service.ts#updatePassword` no longer invokes a reset-update edge function; transport failures from the auth client map to `code:"service_unavailable"`.
4. `ResetPasswordPage` treats `service_unavailable` as a non-counting failure and does NOT decrement attempts or trip the 3-strike lock.

## AUTH_CRITICAL set (never on baseline)
login-with-captcha, send-magic-link, verify-turnstile, validate-email-domain, resend-signup-confirmations, sign-out-all-devices, revoke-user-sessions, delete-account, admin-purge-auth-user, admin-sign-out-all-users, record-consent, record-policy-acknowledgment

## Verification (post-deploy 2026-06-05)
Live curl of all 13 AUTH_CRITICAL functions with bogus JWT — every response is 4xx/5xx (deployed), zero 404 (none missing):
update-password-confirmed→401, login-with-captcha→400, send-magic-link→400, verify-turnstile→400, validate-email-domain→400, resend-signup-confirmations→401, sign-out-all-devices→401, revoke-user-sessions→500, delete-account→401, admin-purge-auth-user→401, admin-sign-out-all-users→401, record-consent→400, record-policy-acknowledgment→520.

## Page-on-first-occurrence (audited-invoke)
`src/integrations/supabase/audited-invoke.ts` now bumps severity to `error` and tags `fingerprint:edge_function_not_deployed:<fn>` whenever any AUTH_CRITICAL invoke returns HTTP 404 or transport_error. The Triage Critical Push 5-min cron pages admins on the FIRST occurrence — silence is no longer possible. Non-critical fns stay at `severity:warn` (no noise regression).
