---
name: Enterprise Auth Rebuild
description: Single-source-of-truth auth module at src/features/auth/** — Result<AuthOk,AuthErr>, XState v5 machine, single AuthFailurePolicy, code-first classifier, opaque-refresh-token fix, AUTH-CORE BDD + auth_prober_results
type: feature
---

Source of truth for all credentialed auth lives in `src/features/auth/**`. Everything else is a thin shim until the consumer rewrite ships.

## Modules

- `domain/auth-result.ts` — `Result<AuthOk, AuthErr>` discriminated union; `AuthOk` covers `signed_in | redirecting_to_provider | mfa_required | verification_email_sent | password_reset_email_sent | password_updated | signed_out`. `AuthErr.code` is one of 18 server-issued `AuthErrorCode` values.
- `domain/auth-codes.ts` — enum, exhaustively switched (tsc-checked).
- `domain/auth-storage-keys.ts` — single writer of every auth localStorage key.
- `services/auth-flow.service.ts` — the ONLY caller of `supabase.auth.*`. `setSessionSafe` validates the access_token shape AND `isNonEmptyOpaqueToken(refresh_token)` (≥20 chars). `isLikelyJwt` on refresh tokens is DELETED — that was the Vichea bug.
- `services/auth-classifier.ts` — code-first; message strings can NEVER produce `invalid_credentials`.
- `services/auth-failure-policy.ts` — the ONLY writer of failure counters / CAPTCHA refresh / device lockout. `client_session_write_failed | network_error | service_unavailable | unexpected` return `{ all four flags = false }` (Vichea cannot produce a lockout).
- `services/auth-telemetry.ts` — `emitAuthBeacon(kind, payload)` → `ops_events` row with `correlationId`.
- `state/auth-machine.ts` — XState v5 FSM: `idle → validating → awaiting_captcha → submitting → (awaiting_mfa) → setting_session → signed_in | failed`. Pages MUST render off `state.value`; boolean `isLoading/isSubmitting/needsCaptcha/needsMfa/isSettingSession` are banned in `ui/` by ESLint.
- `state/use-auth-machine.ts` — single hook exposes `submitPassword | submitGoogle | submitSignUp | submitResetRequest | submitResetComplete | reset`. Forwards typed `Result` back to the machine via `SERVER_OK/SERVER_ERR`.
- `flows/*` — `sign-in-password | sign-in-google | sign-up | request-password-reset | complete-password-reset | consume-recovery-link | sign-out`. Each returns `Promise<AuthResult>`; no throws cross the boundary.
- `ui/SignInForm | SignUpForm | ForgotPasswordForm | ResetPasswordForm | GoogleSignInButton | MfaChallengeDialog | AuthErrorMessage` — pure views bound to the machine. Inputs lock `name="username"/"current-password"/"new-password"` + `autoComplete` for password managers.
- `supabase/functions/auth-broker/` — scaffolded; Phase 5 will route every credentialed call through it. Pinned in `config.toml`, `verify_jwt = true` by default.

## Guard rails (ESLint plugin `auth-invariants`)

- `no-bare-password-set-input` (error) — confirm-password must live in PasswordSetFields (feature-module exempt).
- `no-raw-password-update` (error) — only AuthService legacy + feature module may call `auth.updateUser({password})`.
- `no-direct-supabase-auth` (warn) — bans `supabase.auth.*` / `lovable.auth.*` outside `src/features/auth/**` + auto-generated client + legacy `auth.service.ts` shim. Promote to error after consumer migration.
- `no-direct-failure-counters` (warn) — bans `record_failed_login | recordInvalidAuthAttempt | recordFailedLoginAttempt | recordFailure` outside `auth-failure-policy.ts`.
- `no-auth-storage-literals` (warn) — bans `tfn:reset-attempts | tfn:login-lockout | tfn:auth-strikes | tfn:device-id | supabase.auth.token` literals outside `auth-storage-keys.ts`.
- `no-auth-booleans-in-ui` (error) — bans `useState<boolean>` named `isLoading | isSubmitting | needsCaptcha | needsMfa | isSettingSession` in `src/features/auth/ui/**`.

## Observability

- `auth_prober_results` table (admin-read, service-role-write) — every prober run inserts `{correlation_id, stage, outcome, error_code, latency_ms, prober_user_agent, details}`. Indexed on `created_at` + `(stage, outcome, created_at)`.
- Every state transition / flow call emits one `ops_events` row via `emitAuthBeacon`.

## BDD coverage

30 scenarios under feature_area `AUTH-CORE` (`AUTH-CORE-001..030`) in `bdd_scenarios`. Tri-layer `[UI]/[DB]/[Code]` Then-clauses. Status reflects what currently has tests (`implemented`), what is partially covered (`partial`), or what is queued for the prober/Playwright pyramid (`not_built`).

## Test pyramid (38 passing today)

- `auth-classifier.contract.test.ts` (10) — code-first mapping locked.
- `auth-failure-policy.contract.test.ts` (9) — non-credential branches all-flags-false.
- `auth-storage.contract.test.ts` (4) — purge clears every declared key.
- `auth-flow.contract.test.ts` (6) — opaque refresh token accepted; setSession rejection wrapped in `ClientSessionWriteError` (non-punitive).
- `auth-error-message.contract.test.tsx` (1) — exhaustive AuthErrorCode rendering.
- `auth-machine.contract.test.ts` (8) — `failed` cannot reach `signed_in` without a new SUBMIT/RETRY; RESET rotates correlationId.

## Vichea bug death certificate

Six independent layers prevent recurrence: (1) `isLikelyJwt` deleted on refresh token + regression test, (2) ESLint blocks `supabase.auth.*` outside feature, (3) `AuthFailurePolicy.client_session_write_failed` hard-codes all counters to false, (4) classifier is code-first and message strings cannot produce `invalid_credentials`, (5) `auth-prober` scheduled to run reset→sign-out→sign-in every 5 min, (6) Auth Funnel alerts on `setting_session → failed` drops without matching `invalid_credentials`. Removing the protection requires deliberate edits in five different files.
