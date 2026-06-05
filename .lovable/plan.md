# Permanent Fix: Password Reset Flow

## Root cause (confirmed)

`AuthContext` mounts at app root and the Supabase client has `detectSessionInUrl: true` (default). When the recovery email link lands on `/reset-password`, the SDK consumes the `#access_token=…&type=recovery` hash during `AuthContext`'s initial `getSession()` — often **before** `ResetPasswordPage`'s `onAuthStateChange` subscriber attaches. The hash is stripped, no `PASSWORD_RECOVERY` event reaches the page, and the page falls into `settleFromSession()` → "Invalid or expired link". This matches the DB evidence: 37 recovery emails delivered, zero password updates.

## The fix

### 1. `src/integrations/supabase/client.ts`
Set `detectSessionInUrl: false` on the auth client. We will detect and consume the recovery hash explicitly on `/reset-password` only. OAuth (Google) uses `?code=` query exchange via `exchangeCodeForSession` already, so disabling auto-detect does not break it.

### 2. `src/pages/ResetPasswordPage.tsx`
Rewrite the recovery-detection effect:
- Parse `window.location.hash` for `access_token` + `refresh_token` + `type=recovery`. If present, call `supabase.auth.setSession({ access_token, refresh_token })` and treat success as `validRecovery=true`.
- Parse `?token_hash=…&type=recovery` query (used when we switch the email link to a token_hash URL — see step 3). Call `supabase.auth.verifyOtp({ type: 'recovery', token_hash })`.
- Keep `?code=` PKCE branch as fallback.
- Strip sensitive params from URL via `history.replaceState` after successful settle.
- Subscribe to `onAuthStateChange` for `PASSWORD_RECOVERY` as a defense-in-depth catch.

### 3. `supabase/functions/auth-email-hook/index.ts`
For `email_action_type === 'recovery'`, build the link manually from `payload.email_data.token_hash` + `redirect_to`:
```
https://techfleet.network/reset-password?token_hash=<hash>&type=recovery
```
instead of relying on the default GoTrue `/auth/v1/verify?...` URL. This avoids the PKCE detour entirely and works cross-device, in incognito, and when clicked twice (verifyOtp is idempotent until consumed/expired).

### 4. Supabase Auth redirect allowlist
Add `https://techfleet.network/reset-password`, `https://www.techfleet.network/reset-password`, and `https://techfleetnetwork.lovable.app/reset-password` to the allowlist via `configure_auth` or instruct user to add in Cloud → Auth → URL Configuration. **Will surface to user as a checklist item — cannot read current allowlist programmatically.**

### 5. Diagnostics
Add severity-tagged audit rows at every settle branch (`reset_settle_hash_ok`, `reset_settle_token_hash_ok`, `reset_settle_code_ok`, `reset_settle_session_ok`, `reset_settle_invalid`, `reset_settle_timeout`) via the existing audit helper. severity:info so they don't reach Triage. Next failure will pinpoint the exact branch in `audit_log`.

### 6. Tests
- Update `src/test/ui/ResetPasswordPage.test.tsx`: add cases for hash-token settle and token_hash query settle.
- Extend `e2e/auth/password-reset-roundtrip.e2e.ts`: open the generated link in a **fresh browser context** (different from the one that requested the reset) to prove cross-device works.

### 7. BDD scenarios (`bdd_scenarios` table)
- `AUTH-RESET-020` cross-device recovery (link clicked on different device than request).
- `AUTH-RESET-021` incognito recovery.
- `AUTH-RESET-022` recovery link clicked twice — second click still lands on the form until OTP consumed; after password set, second click shows "expired".
- `AUTH-RESET-023` URL params stripped after settle.

Each with tri-layer [UI]/[DB]/[Code] Then-clauses.

### 8. Memory
- Update `mem://features/auth/password-reset-error-surfacing` with the new contract (detectSessionInUrl off, token_hash link, page handles recovery exclusively).
- Add core rule to `mem://index.md`: "Recovery emails use `?token_hash=…&type=recovery` URL; `detectSessionInUrl=false` so only `ResetPasswordPage` consumes recovery params."

### 9. Deploy
`auth-email-hook` edge function.

## Out of scope
- Changing OAuth/PKCE flow.
- Re-touching `update-password-confirmed`, lockout heal, or `AuthService.updatePassword` — those are correct; nobody was reaching them.
- Signup confirmation / magic link email shape.

## User action required
Confirm (or I'll add via `configure_auth`) that the Supabase Auth redirect allowlist includes the three `/reset-password` URLs above. Without this, GoTrue silently rewrites the link to the Site URL and the fix is moot.
