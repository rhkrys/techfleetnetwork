---
name: Auth Vichea fix — opaque refresh tokens + single failure attribution
description: 2026-06-09 root-cause fix for the recurring "must reset password every sign-in" loop. Refresh tokens are opaque (not JWTs); classifier is code-first via ClientSessionWriteError; only countsAgainstUser:true increments lockout/RPC/CAPTCHA counters.
type: feature
---
## What this fixes

Vichea reported needing to reset their password after every sign-out. Root cause was a single client-side bug that bled into FOUR failure counters:

1. `AuthService.singleFlightSetSession()` validated BOTH access_token AND refresh_token via `isLikelyJwt()`. Supabase access tokens are JWTs; refresh tokens are OPAQUE strings. Every successful login threw `Error("Invalid login response")`.
2. `auth-error-classifier.ts` had a bare `"invalid login"` string pattern that matched `"Invalid login response"` and returned `INVALID_CREDENTIALS` with `countsAgainstUser:true`.
3. `LoginPage.tsx` inner catch fired `recordFailedLoginAttempt()` (CAPTCHA refresh) and `record_failed_login` RPC BEFORE classification, so they incremented on any error.
4. After ~3 attempts, server rate limit / device lockout / suspicious-session revoker triggered → password reset prompt → reset path had the same bug → loop.

## Permanent fix (2026-06-09)

- `src/lib/auth/session-health.ts` — added `isOpaqueRefreshToken(token)` (non-empty string, 20..4096 chars) and typed `ClientSessionWriteError` class with stable `code: "CLIENT_SESSION_WRITE_FAILED"`. Old `isLikelyJwt` retained for access-token-only use.
- `src/services/auth.service.ts:singleFlightSetSession` — validates `access_token` as JWT and `refresh_token` as opaque token. Throws typed `ClientSessionWriteError`, never a generic string.
- `src/lib/auth-error-classifier.ts` — now CODE-FIRST: checks `isClientSessionWriteError(err)` and `err.code === "invalid_credentials"` BEFORE any message-string matching. Bare `"invalid login"` pattern removed; only explicit credential phrases remain (`invalid login credentials`, `invalid credentials`, `invalid email or password`, `email and password didn't match`, `incorrect email or password`).
- `src/pages/LoginPage.tsx` — inner catch is now SINGLE-WRITER: `recordFailedLoginAttempt()` + `record_failed_login` RPC only fire when `classifyAuthError(err).countsAgainstUser === true`. Client-side session-write failures, network errors, service outages, and CAPTCHA throttles increment nothing.
- `src/lib/login-telemetry.ts` — added `"client_session_write_failed"` outcome so the new branch is observable in `record_login_event`.

## Regression suite

`src/lib/__tests__/auth-vichea-regression.test.ts` locks down every rule above. Deleting any test ships the bug.

Key invariants tested:
- `isOpaqueRefreshToken` accepts the realistic Supabase shape.
- `classifyAuthError(new Error("Invalid login response"))` is NEVER `INVALID_CREDENTIALS` — protects against regression even if the old string-throw path returns.
- `classifyAuthError(new ClientSessionWriteError(...))` returns `countsAgainstUser:false`.
- Server-issued `code: "invalid_credentials"` is trusted over message text.

## BDD coverage

`AUTH-VICHEA-001..005` in `bdd_scenarios` (tri-layer per project rule).

## What is NOT yet shipped (Phase 2+ of the enterprise rebuild plan)

The full enterprise rebuild in `.lovable/plan.md` (auth-broker edge function, XState machine, single AuthFailurePolicy module, ESLint rules `no-direct-supabase-auth` / `no-direct-failure-counters`, Madge layer graph, synthetic prober, Auth Funnel tab) is a multi-day shipment. The Vichea-class bug is structurally killed by the code-first classifier + typed `ClientSessionWriteError` + single-writer gate in LoginPage, regardless of whether Phase 2+ ships. Do NOT re-introduce string-based classification of session-write failures.

## Cleanup migration

`20260609_cleanup_vichea_false_lockouts.sql` — idempotent, audit-logged removal of `revoked_sessions` rows tagged `auto_suspicious_activity` and `rate_limits` `login_attempt` rows whose timeline shows ONLY client-side session-write failures (no server `invalid_credentials` in the same window). Dry-run report archived to `audit_log` before any DELETE.
