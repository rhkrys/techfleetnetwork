# Fix: Admin promotion email not sending

## Root cause

The `promote-to-admin` edge function calls `requireFreshAdmin2fa` which requires the calling admin to have a TOTP verification **within the last 10 minutes** (`two_factor_login_sessions.verified_at`). When that window has passed, the function returns **403 "Fresh 2FA verification required"** and bails out *before* creating the `admin_promotions` row or enqueuing the email.

Edge logs confirm this for the user's last attempt: `POST /promote-to-admin → 403`, no new `admin_promotions` row, no `email_send_log` entry.

The UI (`src/pages/UserAdminPage.tsx → handlePromote / handleResendInvite`) just surfaces the error as a generic toast, so it looks like "email broken" when really the action was rejected pre-send.

`admin-purge-auth-user`, `admin-sign-out-all-users`, and `revoke-user-sessions` have the exact same gate, so they hit the same UX hole.

## Fix

Add a small reusable step-up dialog and wire it into the admin actions so a stale 2FA session re-prompts instead of failing silently.

### 1. New component `src/components/StepUpMfaDialog.tsx`
- Adapted from existing `MfaChallengeDialog`.
- Same TOTP entry UX (`InputOTP`, pre-created challenge, `MfaService.verifyChallenge` → which already calls `markCurrentSessionVerified` to refresh `two_factor_login_sessions.verified_at`).
- Cancel just closes the dialog (no `signOut` — user stays logged in, the original action is simply aborted).
- Copy: "Confirm it's you", "Enter the 6-digit code to continue this admin action."

### 2. `src/pages/UserAdminPage.tsx`
- Add a tiny helper `invokeWithStepUp(fnName, body)` that:
  1. Calls `supabase.functions.invoke(fnName, { body })`.
  2. If the response is 403 with message matching `/Fresh 2FA verification required/i`, opens `StepUpMfaDialog`, awaits success, then re-invokes once.
  3. Returns the final result.
- Use it in `handlePromote`, `handleResendInvite`, and `handleDeleteUser` (which calls `admin-purge-auth-user`, also gated).
- Add state: `stepUpRequest: { resolve, reject } | null` to coordinate the async retry with the dialog.

### 3. No backend changes
The edge functions are correct — they should keep enforcing fresh 2FA. The fix is purely UX recovery so the user can complete the action.

## Verification
- Reproduce: log in normally, wait 10+ min, try Promote → dialog appears, enter TOTP, promotion succeeds, `email_send_log` shows new `pending` then `sent` row for `admin_promotion`.
- Cancel path: dialog closes, toast "Admin action cancelled", no promotion created.
- Wrong code: existing `MfaService` error surfaces inline in the dialog; user can retry.

## Files
- **New**: `src/components/StepUpMfaDialog.tsx`
- **Edit**: `src/pages/UserAdminPage.tsx` (wire dialog + retry helper into 3 handlers)
