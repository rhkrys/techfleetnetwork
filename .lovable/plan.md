## What the log entry means

```
source:edge.finalize-password-reset
severity:warn
trace:8da952d10990
reason:missing_token
```

`finalize-password-reset` is gated by `requireAuthenticatedRequest`. The `missing_token` reason fires only when the POST arrives with **no Authorization header at all** — the recovery JWT was already gone by the time the client called `supabase.functions.invoke("finalize-password-reset", ...)`.

Cross-referencing the same timestamp (2026-06-11 00:49:59) in GoTrue logs shows three concurrent `/user` GETs returning `403 bad_jwt` from the same origin. The user's recovery session had been wiped (concurrent tab signed out, password-reset link consumed by another click, or the auth-wedge purge ran) before the submit handler ran, so `supabase-js` sent the request without a session token. The server correctly rejected it, but the member sees one of the generic "session expired / service unavailable" toasts and the activity log records noise.

Only one such row in 14 days for `finalize-password-reset`, so this is a real edge case — but it's exactly the class of bug the user keeps hitting, and the fix is small and root-cause.

## Root-cause fix

1. **Client pre-flight guard in `AuthService.updatePassword`** (`src/services/auth.service.ts`):
   - Before invoking the edge function, call `supabase.auth.getSession()`.
   - If no session, throw a typed `session_expired` error immediately with the existing copy ("Your password reset link expired. Request a new one to continue.") and surface the "Request a new link" CTA the `ResetPasswordPage` already renders. No network call, no audit-log noise.
   - If a session exists, explicitly pass `headers: { Authorization: 'Bearer <access_token>' }` to `functions.invoke` so a concurrent sign-out racing the submit cannot strip the header.

2. **Server-side noise downgrade in `supabase/functions/_shared/request-auth.ts`**:
   - Add an optional `missingTokenSeverity` param (default `"warn"`).
   - `finalize-password-reset` passes `"info"`, since the client now guards and an unauthenticated POST to this specific function is no longer interesting telemetry (still recorded for audit, just not surfaced as warn in the activity log).
   - `invalid_token` stays at `warn` — that one *is* suspicious.

3. **Reset page UX**:
   - `ResetPasswordPage` already handles `session_expired` by showing the "Request a new link" path; verify it surfaces the same flow for the client-guard rejection (no code change expected, just confirm via existing tests).

## Validation

- Extend `src/test/services/auth.service.test.ts`:
  - new case: `updatePassword` throws `session_expired` and does NOT call `supabase.functions.invoke` when there is no session.
  - new case: when a session exists, invoke is called with the explicit `Authorization` header.
- Extend `supabase/functions/finalize-password-reset/index_test.ts` (or add one) to assert that an unauthenticated POST returns 401 AND the recorded audit severity is `info`, not `warn`.
- BDD scenario `AUTH-RESET-025` added to `bdd_scenarios` documenting the pre-flight guard (UI + DB + Code Then-clauses).

## Files expected to change

- `src/services/auth.service.ts`
- `src/test/services/auth.service.test.ts`
- `supabase/functions/_shared/request-auth.ts`
- `supabase/functions/finalize-password-reset/index.ts` (pass `missingTokenSeverity: "info"`)
- one new Supabase migration inserting the BDD scenario

No edits to `ResetPasswordPage.tsx`, the auth state machine, the captcha lifecycle, or anything outside the password-reset path.
