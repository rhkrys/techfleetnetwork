## Enterprise-grade auth rebuild — full architecture

You're right. The current auth is a sediment of patches: `AuthService`, `LoginPage`, `RegisterPage`, `ForgotPasswordPage`, `ResetPasswordPage`, `GoogleSignInButton`, `ProfileSetupDialog`, `auth-error-classifier`, `auth-lockout`, `auth-captcha`, `auth-progressive-lockout`, `oauth-ui-guard`, `session-health`, `auth-wedge-events`, `MfaService`, `MfaEnforcementGuard`, `AdminTwoFactorGraceDialog`, `RateLimitService`, `record_failed_login` RPC, `clear_login_rate_limit_for_email` RPC, `revoked_sessions`, `failed_login_attempts`, `login_attempts`, `two_factor_login_sessions`, `trusted_devices`, `device_binding_nonces`, `auth_wedge_events`, `signup_confirmation_reminders`, `application_confirmation_outbox`, `check-account-identity`, `update-password-confirmed`, `auth-email-hook`. Twelve+ surfaces, three+ counters, four+ classifiers. Of course it breaks.

Enterprise teams (Auth0, Okta, AWS Cognito, Google IAM, GitHub) solve this with **one shape**: a finite state machine, a single typed contract, a single failure attribution boundary, contract tests, and synthetic monitoring. That is what we build.

---

## 1. Architectural principles (non-negotiable)

1. **Single source of truth.** One service owns every call to `supabase.auth` and `lovable.auth`. Nothing else may import them. ESLint enforced.
2. **Discriminated union over exceptions.** Every auth operation returns `Result<AuthOk, AuthErr>`. No throws cross the service boundary. TypeScript exhaustiveness checks every consumer.
3. **State machine, not flags.** Auth is a finite XState machine: `idle → submitting → captcha_required → awaiting_mfa → setting_session → signed_in | failed`. Booleans (`isLoading`, `needsCaptcha`, `needsMfa`, `isSettingSession`) are forbidden in pages.
4. **Single failure attribution.** Exactly one module (`AuthFailurePolicy`) decides whether an event counts as a credential failure, a CAPTCHA failure, a rate-limit hit, or noise. Counters are private to that module.
5. **Server is the source of truth.** Client never decides "this is suspicious", "this is a lockout", "this is invalid credentials" from message strings. Server returns typed codes; client trusts them.
6. **Idempotent + replayable.** Every auth mutation uses the existing idempotency engine. Double-submits and retries are safe.
7. **Defense in depth, not stacked patches.** Each control has a clear layer: input validation → CAPTCHA → rate limit → credential check → MFA → session set → revocation check → audit. Layers don't reach across each other.
8. **Observability first.** Every state transition emits one `ops_events` row with `correlation_id`. We can replay any login from the audit trail.
9. **Contract tested.** Every public method has unit + integration + contract tests + a Playwright smoke + a synthetic prober. No surface ships without all five.
10. **Reversible.** Old files become thin re-exports for one release. If something explodes we roll back the consumers, not the schema.

---

## 2. Target layout

```text
src/features/auth/
  README.md                          state diagram + invariants
  domain/
    auth-result.ts                   Result<AuthOk, AuthErr> discriminated unions
    auth-codes.ts                    enum AuthErrorCode (server-issued)
    auth-events.ts                   typed telemetry event names
    auth-storage-keys.ts             every storage key + zod schema for values
  state/
    auth-machine.ts                  XState FSM for login/reset/register/oauth
    auth-machine.types.ts            states, events, context
    auth-context.tsx                 single AuthProvider, hoisted above router
    use-auth.ts                      typed selector hook
  services/
    auth-flow.service.ts             ONLY caller of supabase.auth / lovable.auth
    auth-classifier.ts               code-first; message-matching is fallback
    auth-failure-policy.ts           ONLY caller of counters/CAPTCHA/lockout
    auth-storage.service.ts          ONLY reader/writer of auth storage keys
    auth-telemetry.ts                ops_events writer with correlation_id
    auth-mfa.service.ts              MFA gate decisions, AAL transitions
    auth-session.service.ts          revocation, idle timeout, refresh
  flows/
    sign-in-password.flow.ts
    sign-in-google.flow.ts
    sign-up.flow.ts
    request-password-reset.flow.ts
    consume-recovery-link.flow.ts
    complete-password-reset.flow.ts
    sign-out.flow.ts
  ui/
    SignInForm.tsx                   pure view, switch(state.value)
    SignUpForm.tsx
    ForgotPasswordForm.tsx
    ResetPasswordForm.tsx
    GoogleSignInButton.tsx
    MfaChallengeDialog.tsx
    AuthErrorMessage.tsx             one component renders every AuthErr.kind
  testing/
    auth-fixtures.ts                 deterministic test users, fake clock
    auth-prober.ts                   synthetic E2E run against staging
    contract/
      auth-flow.contract.test.ts     server-side error codes locked down
      auth-failure-policy.contract.test.ts
      auth-storage.contract.test.ts
      auth-machine.contract.test.ts
src/features/profile-setup/
  profile-setup.service.ts           initFromAuth, autosaveDraft, complete
  use-profile-setup-form.ts          dialog + page share this hook
  profile-setup.contract.test.ts
supabase/functions/auth-broker/      single edge fn that owns ALL server-side auth
  index.ts                           routes: sign-in, refresh, reset-request,
                                     reset-complete, oauth-callback, sign-out
  schemas.ts                         zod request/response per route
  policies.ts                        server-side AuthFailurePolicy mirror
  test/                              Deno tests per route
```

Everything else in `src/services/`, `src/pages/`, `src/lib/auth*` becomes thin re-exports that delegate into `src/features/auth`. Old paths keep working for one release so unrelated code does not break.

---

## 3. The contract (every consumer sees only this)

`AuthOk` covers: `signed_in`, `redirecting_to_provider`, `mfa_required`, `verification_email_sent`, `password_reset_email_sent`, `password_updated`, `signed_out`.

`AuthErr` covers (all server-issued codes, never message-derived):
`invalid_credentials`, `account_locked`, `captcha_required`, `captcha_failed`, `rate_limited`, `google_only_account`, `email_not_confirmed`, `email_provider_unverified`, `weak_password`, `same_password`, `recovery_session_expired`, `recovery_link_consumed`, `client_session_write_failed`, `mfa_required`, `mfa_invalid_code`, `network_error`, `service_unavailable`, `unexpected`.

The classifier is **code-first**: it reads `error.code` / HTTP status returned by GoTrue or the `auth-broker` edge function. Message-string matching is only allowed as a last resort and is forbidden from ever producing `invalid_credentials`. This is the single fix for the Vichea-class bug.

`AuthFailurePolicy.applyAfter(err, ctx)` returns `{ refreshCaptcha, incrementDeviceLockout, recordServerRateLimitFailure, recordCredentialFailureRpc, beaconKind, toastKey }`. Mapping is the single source of truth for what counts as a "bad password":
- `invalid_credentials` → all counters fire.
- `client_session_write_failed`, `network_error`, `service_unavailable`, `unexpected` → **no counter fires**; beacon only.
- `captcha_failed` → CAPTCHA refresh only.
- `rate_limited`, `account_locked` → already counted server-side; no client increment.
- `mfa_invalid_code` → MFA-specific counter only.

---

## 4. The state machine (XState v5)

One machine drives every auth screen. States: `idle`, `validating`, `awaiting_captcha`, `submitting`, `awaiting_mfa`, `setting_session`, `signed_in`, `redirecting_to_provider`, `failed`. Events: `SUBMIT`, `CAPTCHA_OK`, `CAPTCHA_FAIL`, `SERVER_OK`, `SERVER_ERR`, `MFA_OK`, `MFA_FAIL`, `SESSION_OK`, `SESSION_ERR`, `RESET`. Pages only render off `state.value` and call `send(SUBMIT)`. There are no booleans, no race conditions between captcha + submit + setSession, and the machine is testable in isolation with `@xstate/test`.

This kills four whole categories of bug we have today: stale-token race, captcha+submit overlap, premature redirect, setSession reentry. Stacked patches go away.

---

## 5. Server-side: single auth-broker edge function

Today the client calls `supabase.auth.signInWithPassword`, `check-account-identity`, `update-password-confirmed`, plus various RPCs. Each has its own input validation, rate limit, and error shape.

We introduce **`supabase/functions/auth-broker/`** — one edge function that fronts every credentialed auth operation: `sign-in/password`, `sign-in/google-callback`, `sign-up/password`, `password-reset/request`, `password-reset/complete`, `sign-out`, `session/refresh`, `identity/check`. Routes:

- Validate input with zod (one schema per route, exported for the client to share types via `zod-to-ts`).
- Apply CAPTCHA + per-IP/per-email rate limits using existing `peek_rate_limit`/`record_rate_limit_failure` RPCs.
- Call GoTrue with the service role context where needed.
- Translate every GoTrue error into our typed `AuthErrorCode` (server is the only place message-matching is allowed).
- Return a discriminated union response: `{ ok: true, … }` or `{ ok: false, code, retryAfter? }`.
- Emit one `ops_events` row per request with `correlation_id`, `route`, `latency_ms`, `outcome`.
- Use existing `withIdempotency` for password reset complete (prevents double-consume of recovery links).

The browser client calls `auth-broker` instead of `supabase.auth` directly for credentialed flows (Google OAuth still uses `lovable.auth.signInWithOAuth` because the OAuth broker handles the redirect dance — that is unchanged and works).

Why this is the enterprise move:
- Server controls error taxonomy. Client cannot misclassify.
- Server controls failure counting. Bypass is impossible.
- Versioned schemas. Breaking changes are visible in CI.
- Replayable from logs. Every login has one row with the full outcome chain.

Migration path for the `supabase.auth.signInWithPassword` call: `auth-broker/sign-in/password` proxies to GoTrue with `Authorization: anon` headers and returns the resulting session JSON typed. Session writing still happens client-side via `auth-flow.service.ts` (one mutex, validates `access_token` shape only — the Vichea fix lives here).

---

## 6. Defense-in-depth layers (cleanly separated)

```text
Layer 0  Input validation        zod, client + server
Layer 1  Disposable email block  existing local block + DNS-MX check (server)
Layer 2  CAPTCHA                 Turnstile, cross-tab synced, refresh-on-fail
Layer 3  Pre-auth rate limit     peek_rate_limit (per-IP, per-email-hash, per-route)
Layer 4  Credential check        GoTrue via auth-broker
Layer 5  MFA gate                auth-mfa.service.ts, AAL1 → AAL2 transition
Layer 6  Session write           auth-flow.service.ts, single mutex, opaque-token aware
Layer 7  Revocation check        revoked_sessions row + SessionGuard subscription
Layer 8  Idle + max-age timeout  auth-session.service.ts
Layer 9  Audit + telemetry       auth-telemetry.ts → ops_events (90d) + audit_log (forever)
```

Each layer is a separate file with its own contract test. Layers may only depend on lower layers, never sideways or upward (Madge graph enforced in CI).

---

## 7. Account setup (Phase 3, dedupe)

`ProfileSetupDialog`, `ProfileSetupPage`, and the various autosave + complete paths collapse into:
- `profile-setup.service.ts` — `initFromAuth`, `autosaveDraft` (typed allowlist that **excludes** `profile_completed` at the type level), `complete` (the only place `profile_completed=true` is set), `syncJourneyTasks`, `notifyDiscord`.
- `useProfileSetupForm` — state, debounced autosave, completion mutation, error mapping.
- Dialog and page render the same hook. One source of truth.
- `complete` runs Discord notify + journey upsert in one `Promise.allSettled` so partial failures cannot block the UI.

---

## 8. Guard rails (the "never again" mechanism)

### ESLint custom rules (`scripts/eslint-rules/`)

1. `no-direct-supabase-auth` — bans `supabase.auth.*` and `lovable.auth.*` outside `src/features/auth/**` and the auto-generated client.
2. `no-direct-failure-counters` — bans `record_failed_login`, `recordInvalidAuthAttempt`, `recordFailedLoginAttempt`, `RateLimitService.recordFailure` outside `auth-failure-policy.ts`.
3. `no-auth-storage-literals` — bans every auth storage-key literal outside `auth-storage-keys.ts`.
4. `auth-result-exhaustive` — every `switch(result.kind)` must be TS-exhaustive (`assertNever`).
5. `no-auth-booleans-in-ui` — bans `useState<boolean>` named `isLoading|needsCaptcha|needsMfa|isSubmitting` in `ui/` (must come from the machine).
6. `auth-broker-required` — credentialed flows must call `auth-broker`, not GoTrue directly.

### CI scripts (`scripts/ci/`)

- `check-auth-counter-coverage.mjs` — fails if any new file increments an auth counter.
- `check-auth-result-contract.mjs` — fails if any AuthFlow method returns non-`Result`.
- `check-auth-layer-graph.mjs` — Madge dependency-direction check.
- `check-credential-attrs.mjs` — parses sign-in + reset forms, asserts `name="username"` / `name="current-password"` / `name="new-password"` and `autoComplete` values.
- `check-auth-machine-coverage.mjs` — every machine transition must have a `@xstate/test` path.

### Test pyramid

- **Unit (Vitest):** classifier, failure policy, storage service, machine reducers, opaque-refresh-token acceptance.
- **Contract (Vitest):** `AuthFlow.*` against a mocked broker, locked-down response shapes per `AuthErrorCode`.
- **Integration (Deno):** `auth-broker` route tests against a local Supabase. Every error code path is exercised.
- **Component (Testing Library):** `SignInForm`, `ResetPasswordForm`, `MfaChallengeDialog` for each machine state.
- **E2E smoke (Playwright):** valid login, wrong password, password reset → log out → log in with new password (the exact Vichea path), Google sign-in stub, MFA challenge.
- **Synthetic monitoring:** `auth-prober` runs every 5 minutes against staging with a test account, exercising login, refresh, sign-out, password reset. Failures page admins via Triage Critical Push.

### BDD coverage

New `AUTH-CORE-001..030` tri-layer scenarios inserted into `bdd_scenarios` (per project rule). Coverage: valid password login, wrong password, client session-write failure (Vichea), opaque refresh token, recovery session expired, recovery link consumed twice, Google success, Google-only account tries password, reset → log out → log in, password manager autofill Chrome+Safari, device lockout only from server `invalid_credentials`, CAPTCHA refresh only on `captcha_failed`, MFA required, MFA wrong code, MFA cancel signs out, transient `bad_jwt` survives, OAuth redirect preserves `redirectTo`, sign-out clears all storage keys, autosave never sets `profile_completed`, complete sets it once, idle timeout fires at 30 min, max-age fires at 4h, revoked session terminates within one tick, broker rate limit kicks in, suspicious activity revocation is server-issued only, audit row exists for every transition.

---

## 9. Observability + post-deploy verification

- Every state transition emits `ops_events` with `correlation_id` (UUID generated at form mount).
- `auth-broker` includes `correlation_id` in request + response + log lines.
- New admin tab **System Health → Auth Funnel** shows a real-time funnel: submit → captcha → broker → mfa → session set → signed in, with drop-off counts in last 1h/24h/7d.
- Synthetic prober writes one row every 5 min into `auth_prober_results` with stage, latency, outcome. Triage Critical Push pages on 2 consecutive failures.
- One `ops_metrics` daily row: `auth.signin.success`, `auth.signin.invalid_credentials`, `auth.signin.client_session_write_failed`, `auth.signin.mfa_required`, `auth.reset.completed`, `auth.signup.completed`.

If the Vichea bug ever returns, the funnel shows `setting_session` drop-off without a matching `invalid_credentials` server response, and the prober pages within 10 minutes. Today neither signal exists.

---

## 10. Data cleanup (paired with the permanent fix, per your rule)

Idempotent migration (dry-run report → apply → `audit_log` info row, reason `cleanup_from_client_session_write_bug_2026_06_09`):
- Clear `revoked_sessions` rows with `reason='auto_suspicious_activity'` whose matching device emitted `auth.client_session_write_failed` with no `auth.invalid_credentials` from the broker in the same minute.
- Reset `rate_limits` `login_attempt` rows for the same hashed identifiers.
- Clear `failed_login_attempts` rows authored only by the client error path.
- Mark `auth_wedge_events` with reason `transient_bad_jwt` as `acknowledged=true` so they stop poisoning the wedge gate.

---

## 11. Migration strategy (one shipment, reversible)

Order of execution:
1. Skeleton `src/features/auth/*` + `Result` types + `AuthErrorCode` enum.
2. Build `auth-flow.service.ts` with opaque-refresh-token fix + unit tests.
3. Build `auth-failure-policy.ts`; route every counter through it.
4. Build XState machine + `AuthProvider` + `useAuth`.
5. Build `auth-broker` edge function (every route + Deno tests + zod schemas).
6. Rewrite `SignInForm`, `SignUpForm`, `ForgotPasswordForm`, `ResetPasswordForm`, `MfaChallengeDialog`, `GoogleSignInButton` to use the machine + flows.
7. Old `LoginPage`, `RegisterPage`, `ForgotPasswordPage`, `ResetPasswordPage` re-export the new forms (URLs unchanged).
8. Replace `AuthService` with thin re-exports; delete duplicated lockout/captcha/storage modules; consolidate `auth-error-classifier`, `auth-lockout`, `auth-captcha`, `oauth-ui-guard`, `session-health` into the new services.
9. Extract `profile-setup` module; dialog + page share `useProfileSetupForm`.
10. Add ESLint rules + CI scripts + Madge graph check + Playwright smokes + synthetic prober.
11. Insert `AUTH-CORE-001..030` BDD scenarios; mark old `AUTH-PROVIDER-001..004` and `AUTH-RESET-001..006` as `implemented` if covered.
12. Run cleanup migration.
13. Update memory: `mem://features/auth/single-flow-contract`, `mem://features/auth/state-machine`, `mem://features/auth/broker-contract`. Index updated.
14. Toggle synthetic prober + Auth Funnel tab on in System Health.

Reversibility: each consumer file change is a thin shim. If the new machine misbehaves we re-point shims to the old service and roll back per-page. Database changes are additive (`auth_prober_results` table, no destructive drops).

---

## 12. What is explicitly out of scope

- GoTrue config, Supabase project, OAuth client IDs/secrets.
- Email templates and `auth-email-hook` (already correct).
- TOTP enrollment UI in `/profile/edit` (already correct).
- Session revocation `revoked_sessions` schema, idle/max-age values (kept as-is).
- Discord notifications and journey tasks (same triggers, same payloads).
- Marketing/feature copy except where required by the new error taxonomy.

---

## 13. Honest risk register

| Risk | Mitigation |
| --- | --- |
| XState adds a dependency | One small dep (~16KB). Replaces ~12 boolean useStates. Net negative LOC. |
| `auth-broker` is a new edge fn surface | Covered by Deno integration tests per route; pinned in `config.toml`; `verify_jwt=false` only on `sign-in/password` and `password-reset/request` (must be public), all others require JWT. |
| GoTrue error codes change | Classifier is code-first with named fallbacks; contract test pins the mapping; synthetic prober pages within 10 min if a new code path appears. |
| Refactor breaks an unrelated import | Old paths kept as re-exports for one release; CI builds and Playwright smoke must pass to merge. |
| New machine has a transition bug | `@xstate/test` model-based tests exercise every path; Playwright covers the four real user journeys. |

---

## 14. Definition of done

- All 30 BDD scenarios `implemented` and green.
- ESLint rules + CI scripts + Madge graph enforced.
- `auth-broker` deployed with passing Deno tests for every route.
- Synthetic prober running every 5 min on staging + production.
- Auth Funnel tab live in System Health.
- Zero callers of `supabase.auth.*` or counter RPCs outside `src/features/auth/**`.
- Cleanup migration applied with `audit_log` row.
- Memory updated. Index updated.
- Vichea can reset their password once, sign out, sign back in with the new password, in Chrome, Safari, Firefox, iOS, Android, and a password manager. Verified by the prober every 5 minutes from now on.

This is what Fortune-500 auth looks like: one contract, one machine, one broker, one failure policy, one storage module, one source of truth — and continuous proof that it still works.

---

## 15. How Vichea's bug dies — line by line

The exact failure chain today:

```text
Vichea submits correct password
  → supabase.auth.signInWithPassword OK
  → AuthService.singleFlightSetSession() receives { access_token, refresh_token }
  → isLikelyJwt(refresh_token) === false  (opaque string, not 3-segment JWT)
  → throws Error("Invalid login response")
  → LoginPage catch block: classifyAuthError("Invalid login response")
     → matches the substring "Invalid login" → returns INVALID_CREDENTIALS
  → LoginPage fires: record_failed_login + recordInvalidAuthAttempt
                   + RateLimitService.recordFailure + recordFailedLoginAttempt
  → After 3 attempts: server rate_limit OR device lockout OR suspicious-session
     revoker fires → Vichea is told to reset
  → ResetPasswordPage has the SAME singleFlightSetSession bug → loop repeats
```

The new chain, by file:

```text
Vichea submits correct password
  → SignInForm send({type:"SUBMIT", email, password, captchaToken})
  → auth-machine transitions: idle → validating → awaiting_captcha → submitting
  → flows/sign-in-password.flow.ts calls auth-broker/sign-in/password (POST)
  → auth-broker validates input (zod), checks rate limit (peek_rate_limit),
    calls GoTrue, translates response to typed { ok:true, session } | { ok:false, code }
  → flow receives typed session, calls auth-flow.service.ts.setSession(session)
  → auth-flow validates ONLY access_token shape (3-segment JWT, base64url)
    AND refresh_token is a non-empty string >= 20 chars  (the Vichea fix)
  → setSession resolves → machine: setting_session → signed_in
  → telemetry: ops_events row { kind:"auth.signin.success", correlation_id }
```

Where the bug specifically cannot recur:

1. **`isLikelyJwt(refresh_token)` is deleted.** Replaced with `isNonEmptyOpaqueToken(refresh_token)`. A regression test in `auth-flow.service.test.ts` named `accepts opaque refresh token from GoTrue` calls `setSession` with the actual opaque shape Supabase returns and asserts success. CI fails if anyone reintroduces the JWT check.
2. **No page can call `setSession`.** ESLint rule `no-direct-supabase-auth` blocks every file outside `src/features/auth/**` from importing `supabase.auth`. The only mutex lives in `auth-flow.service.ts`.
3. **Even if `setSession` failed, the policy refuses to penalize.** `auth-failure-policy.ts` hard-codes `client_session_write_failed` to `{ recordCredentialFailureRpc:false, incrementDeviceLockout:false, recordServerRateLimitFailure:false, refreshCaptcha:false }`. A contract test asserts every counter is zero after this branch. The Vichea bug cannot produce a lockout even if it somehow regressed.
4. **Classifier is code-first.** `auth-classifier.ts` reads the typed `code` field returned by `auth-broker`. Message strings can never produce `invalid_credentials` (ESLint regex test + unit test "classifier rejects 'Invalid login response' as invalid_credentials").
5. **Prober catches it within 10 minutes.** `auth-prober.ts` performs `reset → sign-out → sign-in with new password` every 5 min on a sealed test account. Two failures page admins. We would know within one cron tick, not days.
6. **Funnel makes it visible.** Auth Funnel shows a `setting_session → failed` drop without a matching `invalid_credentials` broker outcome. That drop has zero allowed quota; alert fires.

The bug requires deleting: one unit test + one contract test + one ESLint rule + one prober scenario + the funnel alert. Five deliberate acts in five different files.

---

## 16. How every other auth surface is protected

**Email/password sign-in** — covered above. Plus: idempotency key on submit prevents double-counting from double-clicks; CAPTCHA state is cross-tab synced (already implemented, kept); pre-auth `peek_rate_limit` returns retry-after before GoTrue is touched, so honest users behind a NAT don't punish each other.

**Google sign-in** — `lovable.auth.signInWithOAuth` is wrapped by `flows/sign-in-google.flow.ts`. Returns `{ kind:"redirecting_to_provider" }` or a typed error. Callback handled by `auth-broker/sign-in/google-callback` which writes the session through the same `auth-flow.service.setSession`. Same opaque-token fix. ESLint rule `auth-broker-required` blocks any page from doing its own callback parsing. The "Google-only account tries password" case is server-issued (`google_only_account` code) so the UI cannot misroute it.

**Sign-up** — `flows/sign-up.flow.ts` calls `auth-broker/sign-up/password`. Server enforces HIBP, weak-password, disposable-email, and DNS-MX checks. Returns typed `verification_email_sent` or `email_provider_unverified`. `application_confirmation_outbox` row is enqueued inside the broker (transactional), so the confirmation email cannot be missed by a client crash mid-redirect. Idempotency key prevents duplicate accounts on retries.

**Password reset request** — `flows/request-password-reset.flow.ts` → `auth-broker/password-reset/request`. Rate limited per IP + per email hash. Returns `password_reset_email_sent` always (no account enumeration). Email queued through existing `auth_emails` lane (already isolated).

**Password reset complete** — `flows/complete-password-reset.flow.ts` → `auth-broker/password-reset/complete`. `withIdempotency` wraps the request hashed on the recovery token, so a double-click cannot consume the link twice (`recovery_link_consumed` returned on replay). On success, broker calls `clear_login_rate_limit_for_email` and `revoked_sessions` cleanup atomically in one SECURITY DEFINER RPC, so device + server lockout heal in the same transaction. Form unmount race is gone because the machine handles transition; no more "setSuccess(true) before password manager flush" — the machine waits in `setting_session` until the autofill promise resolves.

**Sign-out** — `flows/sign-out.flow.ts` → `auth-broker/sign-out` writes the `revoked_sessions` row first, then best-effort calls GoTrue `signOut`, then clears storage via `auth-storage.service.purgeOnSignOut()`. Order matters: revocation row first means even a GoTrue failure cannot leave a usable session. Existing `SessionGuard` already subscribes to revocation; unchanged.

**MFA challenge** — `auth-mfa.service.ts` owns the AAL1→AAL2 transition. The machine has explicit `awaiting_mfa` state; pages cannot navigate to protected routes until the machine reaches `signed_in`. The 10-second quiet window (`recentlyVerifiedAtRef`) is moved into the machine context with `after` transitions, so it cannot drift from the focus handler. Cancel sends `RESET` which forces sign-out before redirect.

**Account setup** — `profile-setup.service.ts` is the only writer of `profile_completed`. Autosave uses a typed allowlist that excludes that field at the type level (`Omit<ProfileFields, 'profile_completed'>`). The `complete()` function is gated by a server-side RPC that requires the user's AAL and recent-credential proof. Dialog + page share the same hook, so a fix in one is a fix in both.

**Session revocation / wedge recovery** — `auth-session.service.ts` owns subscription + idle timeout + transient bad_jwt handling (kept). The existing two-strike `decidePurgeOnBadJwt` is preserved, but its strikes table is read-only outside the service. The wedge gate cannot be poisoned by client-side false-positives because the broker is the only source of `invalid_credentials`.

**Auth emails** — already correct. The broker routes signup confirmation, recovery, magic-link, reauthentication through the existing `auth-email-hook` and `auth_emails` lane. The workspace token bucket already protects deliverability. We do not change templates; we only ensure the broker enqueues exactly once with idempotency.

---

## 17. Why this architecture stops regressions

A regression in any of the above requires breaking at least three independent layers that all live in different files and are owned by different abstractions:

1. **Type system.** `Result<AuthOk, AuthErr>` exhaustiveness means a new error branch is a compile error in every consumer. Adding a code without handling it cannot ship.
2. **State machine.** Transitions are declared, not coded. A page cannot navigate to `signed_in` from `failed` without a transition that does not exist. `@xstate/test` exercises every path; missing paths fail CI.
3. **Layer graph.** Madge enforces the defense-in-depth direction. UI → flows → services → broker. Any reverse edge (e.g. a UI file importing `supabase.auth`) fails CI.
4. **Single-writer modules.** Counters, storage keys, `supabase.auth` calls each have exactly one allowed file. ESLint rules per writer. A second writer cannot be added without a code review that deletes the rule.
5. **Contract tests.** The broker's response shapes are locked. A schema drift breaks contract tests across client + server simultaneously.
6. **Synthetic prober.** Even if all above are bypassed, the prober runs the real path every 5 min and pages admins on 2 failures. The funnel dashboard makes silent regressions visible within hours, not days.

The historical pattern — "small patch over here, small patch over there, until two patches conflict" — is structurally prevented because the patches have nowhere to live. The only writer is the layer that owns the concern. New behavior is added by extending the typed contract, which forces every consumer to update.

---

## 18. Vulnerability assessment (regression + security)

### Regression risk

| Class | Today | After |
| --- | --- | --- |
| Client misclassifying server response | High (4 classifiers, message-based) | Near zero (one classifier, code-first, contract-tested) |
| Counter inflation from non-credential errors | High (4 counters fired from 1 catch block) | Zero (policy is the only writer; non-credential branches set all flags to false) |
| Race between captcha + submit + setSession | Medium (booleans across 3 files) | Zero (single FSM; states are mutually exclusive) |
| Double-consume of recovery link | Low but possible | Zero (idempotency engine) |
| Storage key drift | Medium (literals scattered) | Zero (ESLint rule + single module) |
| Page importing `supabase.auth` directly | Medium | Zero (ESLint rule) |
| Profile autosave marking profile complete | Low (type allowlist not enforced) | Zero (TS `Omit<>` at the type level) |
| Unknown GoTrue error code shipped | N/A | Caught by prober within 10 min; falls back to `unexpected` which the policy treats as non-punitive |
| Refactor breaking unrelated code | Medium | Low — old paths re-export for one release; CI gates merge |

### Security risk

| Concern | Mitigation |
| --- | --- |
| `auth-broker` is a new public surface | `verify_jwt=false` only on the two routes that must be public (`sign-in/password`, `password-reset/request`). All others require a valid JWT. Pinned in `config.toml`. CI guard `check-edge-function-coverage.mjs` enforces it. |
| Public broker becomes an oracle for account enumeration | Reset request always returns `password_reset_email_sent`; sign-in returns `invalid_credentials` for both wrong-password and unknown-email, with constant-time padding inside the broker (existing pattern). Rate limited per IP + per email hash. |
| Broker becomes a DoS amplifier | Pre-auth `peek_rate_limit` returns 429 before GoTrue is touched. Per-route quotas. Circuit breaker on GoTrue (existing CircuitBreaker pattern). |
| Idempotency engine replays could expose stale tokens | Replays only return non-sensitive `{ ok:true, message }` shapes; sessions are written client-side and never serialized into the idempotency cache (audited in contract test). |
| Storage keys exposed to XSS via localStorage | Unchanged from today; tokens are still in `supabase.auth.token` per Supabase default. Mitigation is existing CSP + HttpOnly cookies-where-possible work, out of this scope. Worth noting: the rebuild does not regress this posture. |
| ESLint rule disabled to ship a hotfix | A disabled rule shows up in the lint diff; PR review requirement. Optional follow-up: add a CI check that fails if `eslint-disable` appears in `src/features/auth/**` or for any of the six custom rules anywhere. |
| Server-side classifier leaks user state | Broker error codes are public-safe (no internal IDs, no user-state details). Audit covered by Deno integration tests + a separate security review checklist before merge. |
| Rotation-aware admin client breaks broker | Broker uses the existing service-role-auth shared module (COALESCE vault lookup, opaque + JWT secrets) so key rotation does not cause silent 401 storms. |
| MFA bypass via state-machine manipulation | Machine state lives in React memory only; the authoritative AAL check is server-side at every protected route (existing pattern). Even if a malicious user forces the machine to `signed_in`, the next API call fails. |

### Outstanding risk (named explicitly)

- **The cleanup migration touches real rows.** It is dry-run first, with the dry-run report archived in `audit_log` before any DELETE. Scope is narrow (only rows whose telemetry confirms the client-bug fingerprint). If the dry-run looks wrong, we do not apply.
- **`@xstate/test` adds CI time.** Model-based tests are fast (~3s) but add a step. Acceptable.
- **One-release shim window.** Old paths re-export new code. If a non-auth file accidentally depends on a removed symbol, the shim catches it. The shims have a `@deprecated` tag and a CI warning that escalates to error after one release.
- **Synthetic prober uses a sealed test account.** Credentials live in `mem://project/test-credentials` (already documented as non-shared). Rotated quarterly. Prober failures do not increment user-facing counters because the policy excludes the prober's user-agent.

This is the architecture, the bug-by-bug death of each regression class, and the named places it could still hurt us — with the controls that bring each risk down to "structurally prevented" or "caught within 10 minutes."