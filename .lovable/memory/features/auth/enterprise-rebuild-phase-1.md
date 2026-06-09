---
name: Auth enterprise rebuild — Phase 1 foundation
description: Typed contract (AuthErrorCode/Result/AuthOk/AuthErr), AuthFailurePolicy single-writer, code-first classifier, storage-key registry at src/features/auth/; contract tests lock Vichea invariant
type: feature
---

# Auth enterprise rebuild — Phase 1 foundation (shipped 2026-06-09)

Phase 1 of the multi-phase enterprise auth rebuild. Lays the typed contract
and single-writer modules that every later phase plugs into.

## Shipped

- `src/features/auth/domain/auth-codes.ts` — `AuthErrorCode` enum + `isAuthErrorCode` + `assertNever`. 18 codes, server-issued only.
- `src/features/auth/domain/auth-result.ts` — `Result<T,E>`, `AuthOk`, `AuthErr`, `ok()`, `err()`.
- `src/features/auth/domain/auth-storage-keys.ts` — single registry; will be enforced by `no-auth-storage-literals` ESLint rule.
- `src/features/auth/services/auth-failure-policy.ts` — `decideFailureActions(code)` is the SINGLE module allowed to authorize counter writes.
- `src/features/auth/services/auth-classifier.ts` — code-first; `FORBIDDEN_STRING_CODES` prevents punitive codes from message strings.
- `src/features/auth/testing/contract/*.test.ts` — 19 tests pin Vichea invariant + classifier code-first behavior.
- `src/features/auth/README.md` — state diagram + invariants + shipped/queued matrix.

## Locked invariants (regression = CI failure)

1. Only `invalid_credentials` may set `recordCredentialFailureRpc=true` or `incrementDeviceLockout=true`.
2. `client_session_write_failed`, `network_error`, `service_unavailable`, `unexpected` fire ZERO counters.
3. `rate_limited` and `account_locked` never re-increment client counters (already counted server-side).
4. String-matched paths in the classifier can never emit `invalid_credentials`, `account_locked`, `rate_limited`, `captcha_required`, `mfa_invalid_code`.

## Queued (still to ship)

- Phase 2: `auth-flow.service.ts`, `auth-storage.service.ts`, XState machine + `AuthProvider`.
- Phase 3: `supabase/functions/auth-broker/` (server-side error taxonomy + rate limit + idempotency).
- Phase 4: `flows/*` + UI rewrite (SignInForm etc.); old pages become thin re-exports.
- Phase 5: ESLint custom rules (`no-direct-supabase-auth`, `no-direct-failure-counters`, `no-auth-storage-literals`, `auth-result-exhaustive`, `no-auth-booleans-in-ui`, `auth-broker-required`) + Madge graph CI + `auth-prober` synthetic monitor + System Health Auth Funnel tab.
- Phase 6: BDD `AUTH-CORE-001..030` insert into `bdd_scenarios` + cleanup migration for false-positive lockouts.

## Rule for future edits

Any new auth code path MUST go through `decideFailureActions()` for counter
decisions and `classifyAuthErrorCode()` for error classification. Do NOT add
parallel classifiers or counter call sites — extend the existing ones.
