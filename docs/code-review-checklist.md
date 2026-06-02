# Secure Code Review Checklist (ASVS L2 aligned)

Use for every PR that touches auth, RLS, edge functions, file uploads, AI calls, or rendered HTML.

## V1 — Architecture
- [ ] No new public endpoint without explicit threat-model entry in `docs/attack-surface.md`.
- [ ] No service-role key shipped to the browser.
- [ ] Trust boundary crossings re-validate input.

## V2 — Authentication
- [ ] All auth flows go through Supabase client (no custom JWT issuance).
- [ ] MFA enforcement preserved for admins.
- [ ] Failed-login telemetry calls `record_failed_login`.
- [ ] Credential-mutation screens use shared `<PasswordSetFields>`; no hand-rolled new-password inputs.
- [ ] Password updates go through `AuthService.updatePassword` and `update-password-confirmed`; no page-level `auth.updateUser({ password })`.
- [ ] Password reset changes include reset → sign out/clear session → sign in with new password coverage.
- [ ] Password-update audit rows include `confirmed:true`; unconfirmed paths must fail.

## V3 — Session
- [ ] No new long-lived tokens > 4h.
- [ ] Session revocation respected (`is_session_revoked` consulted where required).

## V4 — Access control
- [ ] Every new table has RLS enabled and explicit SELECT/INSERT/UPDATE/DELETE policies.
- [ ] Admin checks use `has_role()` SECURITY DEFINER, NOT a column on `profiles`.
- [ ] Client-side `isAdmin` is UX only — never the sole authorization.

## V5 — Validation, sanitization, encoding
- [ ] All user input parsed with Zod (client + edge fn).
- [ ] User HTML routed through `sanitizeHtml()` AND server-side `sanitize_user_html()` trigger.
- [ ] `deepSanitize()` applied to any object reaching `.update()` / `.insert()`.
- [ ] No `dangerouslySetInnerHTML` without sanitizer.

## V6 — Stored cryptography
- [ ] No secrets in repo. Use Supabase Vault.
- [ ] No hand-rolled crypto.

## V7 — Errors & logging
- [ ] Errors surfaced with `safeErrorMessage()`; no stack traces in client responses.
- [ ] Sensitive operations call `write_audit_log` with OWASP-prefixed event names (`authn_*`, `authz_*`, `excess_*`, `input_validation_*`).

## V8 — Data protection
- [ ] PII access by admins logged via `log_pii_access()`.
- [ ] No PII written to console / logs in production.

## V9 — Communication
- [ ] All fetches go to allow-listed hosts (CSP `connect-src` updated if new host).
- [ ] `isSafeExternalUrl()` used before any user-influenced fetch.

## V10 — Malicious code
- [ ] No new dependency added without checking `npm audit` and Aikido scan.
- [ ] `package.json` `overrides` reviewed for transitive vulns.

## V11 — Business logic
- [ ] Rate limits applied to expensive operations (`check_rate_limit`).
- [ ] Idempotency keys on email enqueue.

## V12 — Files & resources
- [ ] All new uploads go through `validate-upload` edge fn (magic-byte + dimension + size + extension allow-list, SVG forbidden).
- [ ] No file path concatenated from user input without `sanitizeFileName`.

## V13 — API
- [ ] Every edge fn validates JWT or service-role.
- [ ] CORS strict (no wildcards on credentialed responses).

## V14 — Configuration
- [ ] No new `'unsafe-*'` directive in CSP.
- [ ] HTTP headers in `_headers` reviewed if new third-party host added.
