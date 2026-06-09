# Auth (enterprise rebuild)

Single source of truth for every credentialed flow. See the enterprise auth
rebuild plan in chat history (sections 1–18) for the full architecture.

## State diagram (target)

```text
            ┌───────┐
            │ idle  │◀─────────────┐
            └──┬────┘              │
        SUBMIT │                   │ RESET
               ▼                   │
       ┌─────────────┐    fail     │
       │ validating  │─────────────┤
       └──┬──────────┘             │
          │ ok                     │
          ▼                        │
  ┌──────────────────┐  CAPTCHA_FAIL │
  │ awaiting_captcha │───────────────┤
  └──┬───────────────┘               │
     │ CAPTCHA_OK                    │
     ▼                               │
   ┌─────────────┐  SERVER_ERR       │
   │ submitting  │───────────────────┤
   └──┬──────────┘                   │
      │ SERVER_OK                    │
      ▼                              │
 ┌────────────────┐  MFA_FAIL        │
 │ awaiting_mfa   │──────────────────┤
 └──┬─────────────┘                  │
    │ MFA_OK / not required          │
    ▼                                │
 ┌──────────────────┐  SESSION_ERR   │
 │ setting_session  │────────────────┤
 └──┬───────────────┘                │
    │ SESSION_OK                     │
    ▼                                │
  ┌─────────────┐                    │
  │ signed_in   │                    │
  └─────────────┘                    │
                                     ▼
                                  ┌──────┐
                                  │ fail │
                                  └──────┘
```

## Invariants

1. Only `services/auth-flow.service.ts` may import `supabase.auth`.
2. Only `services/auth-failure-policy.ts` may decide counter writes.
3. Only `services/auth-storage.service.ts` may read/write auth storage keys.
4. Every flow returns `Result<AuthOk, AuthErr>` — no throws cross the boundary.
5. The classifier is **code-first**; message strings can NEVER emit
   `invalid_credentials`, `account_locked`, `rate_limited`, `captcha_required`,
   or `mfa_invalid_code`.
6. The Vichea branch (`client_session_write_failed`) fires zero counters.
   Locked by `auth-failure-policy.contract.test.ts`.

## Shipped (Phase 1)

- `domain/auth-codes.ts` — `AuthErrorCode` taxonomy + exhaustiveness helper.
- `domain/auth-result.ts` — `Result`, `AuthOk`, `AuthErr`.
- `domain/auth-storage-keys.ts` — single registry of storage keys.
- `services/auth-failure-policy.ts` — single failure attribution boundary.
- `services/auth-classifier.ts` — code-first classifier (Vichea-safe).
- `testing/contract/*` — contract tests pin both invariants.

## Queued (Phase 2+)

- `state/auth-machine.ts` (XState v5) + `AuthProvider`.
- `services/auth-flow.service.ts` (the only `supabase.auth` caller).
- `services/auth-storage.service.ts` (replaces literal storage-key usage).
- `flows/*` (one file per credentialed flow).
- `supabase/functions/auth-broker/` (server-side error taxonomy + rate limiting).
- `ui/SignInForm.tsx` etc. and re-export shims for the existing pages.
- ESLint rules + Madge graph CI + `auth-prober` synthetic monitor.
- BDD `AUTH-CORE-001..030` scenarios into `bdd_scenarios`.
- Cleanup migration for false-positive lockouts.
