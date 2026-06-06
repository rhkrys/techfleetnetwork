---
name: Password Reset Error Surfacing + Lockout Heal + token_hash Link
description: Recovery link format, ResetPasswordPage verifyOtp flow, error mapping, lockout heal
type: feature
---

## Recovery link format (root cause fix, 2026-06-05)

The `auth-email-hook` edge function REWRITES the recovery email link before render:
- Parses `payload.data.url` (default GoTrue `/auth/v1/verify?token=<hash>&type=recovery&redirect_to=<...>`).
- Emits `${redirect_to_origin}/reset-password?token_hash=<hash>&type=recovery` instead.
- Forces pathname to `/reset-password` even if `redirect_to` is misconfigured (defense-in-depth).

**Why:** Default GoTrue verify URL redirects to `/reset-password#access_token=…&type=recovery`. With `detectSessionInUrl: true`, `AuthContext`'s mount-time `getSession()` consumed the hash BEFORE `ResetPasswordPage`'s `onAuthStateChange` subscriber attached. Result: hash stripped, no `PASSWORD_RECOVERY` event, page fell into invalid-link branch. DB evidence: 37 recovery emails delivered, zero password updates over 7 days.

**Permanent fix (2026-06-05):** `src/integrations/supabase/client.ts` sets `detectSessionInUrl: false`. ResetPasswordPage now consumes recovery params explicitly. The managed `auth-email-hook` is registered/deployed and rewrites recovery emails to direct app URLs (`/reset-password?token_hash=…&type=recovery`) before queueing, so members never have to land on the backend `/verify` URL first. The email queue worker must not call `.catch()` on `supabase.rpc()` results; use safe RPC handling so sent recovery emails are deleted from the queue instead of reprocessed into duplicate stale-link sends. Google OAuth is unaffected because the Lovable wrapper (`src/integrations/lovable/index.ts`) calls `supabase.auth.setSession(result.tokens)` directly — it never relied on URL auto-detection. **Required Supabase Auth redirect allowlist entries:** `https://techfleet.network/reset-password`, `https://www.techfleet.network/reset-password`, `https://techfleetnetwork.lovable.app/reset-password`.

## ResetPasswordPage settle order

1. `?token_hash=…&type=recovery` → `supabase.auth.verifyOtp({type:"recovery", token_hash})` (PRIMARY, idempotent until consumed/expired, works cross-device/incognito/double-click).
2. `?code=…` → `exchangeCodeForSession(code)` (PKCE fallback).
3. `#access_token=…&type=recovery` → wait 8s for SDK to process, then `getSession()` (legacy fallback).
4. None of the above → `getSession()` to honor any active recovery session.

All successful branches call `stripSensitiveParams()` via `history.replaceState` to clear `token_hash`, `type`, `code`, `access_token`, etc. from the address bar.

## Error mapping (unchanged)

`update-password-confirmed` maps GoTrue errors to `{same_password|weak_password|session_expired|rate_limited}` with actionable copy; 3-strike form lock via `tfn:reset-attempts`; successful reset clears device + server login lockout via `clear_login_rate_limit_for_email` RPC; LoginPage honors `?from=password-reset` to drop residual lockout.

## Google-only accounts (root cause fix, 2026-06-06)

Forgot-password must call `check-account-identity` before `resetPasswordForEmail`. If an account has Google identity and no password identity, show Google sign-in guidance and do **not** call the password-reset service or record a password-reset failure. The helper must resolve by immutable `profiles.email -> user_id -> auth.admin.getUserById`; do not use `/auth/v1/admin/users?filter=email eq ...`, which silently returned no identities for Google-only accounts and caused repeated reset attempts to hit the backend 60-minute limiter.

## BDD: AUTH-RESET-001..006, AUTH-RESET-010..012, AUTH-RESET-020..023, AUTH-RESET-GOOGLE-ONLY-001.

## Out of scope of this fix
- OAuth/PKCE flow (uses `?code=` exchange, untouched).
- Signup confirmation or magic link email shape.
- AuthContext bootstrap behavior.

## Supabase Auth redirect allowlist requirement
Must include `https://techfleet.network/reset-password`, `https://www.techfleet.network/reset-password`, `https://techfleetnetwork.lovable.app/reset-password`. Without these, GoTrue silently rewrites `redirect_to` to the project Site URL and the link lands on the wrong page.

## Settle-branch diagnostics (audit_log, severity:info)

ResetPasswordPage writes one `reset_settle_<branch>_(ok|fail)` audit_log row per page mount via `write_audit_log` RPC with `changed_fields = ['severity:info', 'path:...', 'has_hash:...']`. Branches:
- `token_hash` — primary verifyOtp success
- `token_hash_invalid` — verifyOtp rejected the OTP
- `code` — PKCE exchange success
- `code_invalid` — PKCE exchange rejected
- `hash` — legacy `#access_token` fallback success
- `session` — PASSWORD_RECOVERY/SIGNED_IN event from subscription
- `no_params` — page loaded with no recovery markers
- `timeout` — 8s legacy-hash wait elapsed without a session
- `invalid` — generic getSession failure

severity:info keeps these out of Triage; next outage can be diagnosed without instrumenting fresh.
