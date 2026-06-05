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

**Why:** Default GoTrue verify URL redirects to `/reset-password#access_token=…&type=recovery`. The Supabase client has `detectSessionInUrl: true` (default), so `AuthContext`'s mount-time `getSession()` consumes the hash BEFORE `ResetPasswordPage`'s `onAuthStateChange` subscriber attaches. Result: hash stripped, no `PASSWORD_RECOVERY` event reaches the page, page falls into invalid-link branch. DB evidence: 37 recovery emails delivered, zero password updates over 7 days.

## ResetPasswordPage settle order

1. `?token_hash=…&type=recovery` → `supabase.auth.verifyOtp({type:"recovery", token_hash})` (PRIMARY, idempotent until consumed/expired, works cross-device/incognito/double-click).
2. `?code=…` → `exchangeCodeForSession(code)` (PKCE fallback).
3. `#access_token=…&type=recovery` → wait 8s for SDK to process, then `getSession()` (legacy fallback).
4. None of the above → `getSession()` to honor any active recovery session.

All successful branches call `stripSensitiveParams()` via `history.replaceState` to clear `token_hash`, `type`, `code`, `access_token`, etc. from the address bar.

## Error mapping (unchanged)

`update-password-confirmed` maps GoTrue errors to `{same_password|weak_password|session_expired|rate_limited}` with actionable copy; 3-strike form lock via `tfn:reset-attempts`; successful reset clears device + server login lockout via `clear_login_rate_limit_for_email` RPC; LoginPage honors `?from=password-reset` to drop residual lockout.

## BDD: AUTH-RESET-001..006, AUTH-RESET-010..012, AUTH-RESET-020..023.

## Out of scope of this fix
- OAuth/PKCE flow (uses `?code=` exchange, untouched).
- Signup confirmation or magic link email shape.
- AuthContext or detectSessionInUrl client config.

## Supabase Auth redirect allowlist requirement
Must include `https://techfleet.network/reset-password`, `https://www.techfleet.network/reset-password`, `https://techfleetnetwork.lovable.app/reset-password`. Without these, GoTrue silently rewrites `redirect_to` to the project Site URL and the link lands on the wrong page.
