# Password reset “rejected forever, then locked out” — root cause + permanent fix

## What actually happened

I traced the flow `email link → /reset-password → AuthService.updatePassword → edge fn update-password-confirmed → supabase.auth.updateUser({password})`.

The edge function (`supabase/functions/update-password-confirmed/index.ts`) collapses **every** GoTrue rejection into the same generic string:

```ts
if (updateError) {
  return jsonResponse({ error: "Failed to update password. Please try again." }, 400);
}
```

GoTrue rejects password updates for several distinct reasons, and the user sees none of them:

1. `same_password` — new password equals current password (Supabase default since GoTrue v2.155). Most common cause of “it keeps rejecting me”: the user is typing the password they’ve been using.
2. `weak_password` — HIBP leaked-password check is enabled on this project (per memory). A password that passes our zod regex can still be in the breach corpus.
3. `session_not_found` / expired recovery JWT — the 5‑second wait + 1‑hour link TTL elapsed; the PATCH `/user` call goes through but auth layer rejects.
4. `over_request_rate_limit` — GoTrue’s per‑IP `/user` PATCH limiter kicks in around the 5th retry.

Because the UI shows the same red banner each time (“Failed to update password. Please try again.”), the user retypes the same password and keeps hitting submit. There is **no client‑side circuit breaker on the reset form** and **no max‑attempt guard** — the button stays enabled forever.

Then the user gives up, goes to `/login`, and tries their old password. `LoginPage` uses `recordInvalidAuthAttempt()` (sessionStorage), which trips at **5 failed attempts** with progressive lockout (30s → 1m → 2m → 5m). That is the “locked out” they reported. The device‑lockout auto‑heal only fires on `LoginPage` mount with ≤60s remaining, so a 5‑min lock sticks.

Net: the swallowed error message is the *cause*; the login lockout is the *symptom*.

## Permanent fix (shipped together, no band‑aid)

### 1. Stop swallowing GoTrue errors — edge function (`update-password-confirmed`)
Map GoTrue’s `error.code` / message to a structured response the client can act on:

```ts
// pseudo
const code = classifyGoTrueError(updateError);   // "same_password" | "weak_password" | "session_expired" | "rate_limited" | "unknown"
return jsonResponse({ error: messageFor(code), code }, statusFor(code));
```

- `same_password` → 400, “Pick a password you haven’t used here before.”
- `weak_password` (HIBP) → 400, “This password appeared in a known data breach. Choose a different one.”
- `session_expired` / `session_not_found` → 401, “Your reset link expired. Request a new one.” (UI auto‑routes to `/forgot-password`)
- `over_request_rate_limit` → 429, “Too many attempts. Wait 60 seconds and try again.” (with `Retry-After`)

Audit each branch with its own `reason:<code>` tag so Triage shows real distribution.

### 2. Stop the “retry forever” loop — `ResetPasswordPage`
- Field‑level errors (mismatch, length, HIBP, same_password) render inline under the password input, not as the form‑level red banner.
- Hard cap: after **3 server rejections** the form disables itself and shows a single CTA: “Request a new reset link”. (Sessionstorage key `tfn:reset-attempts`, cleared on success or new recovery event.)
- `session_expired` from the edge fn replaces the form with the existing “Invalid or expired link” panel automatically — no need for the user to figure it out.
- Pre‑submit HIBP hint: call the existing leaked‑password helper on blur so the user sees the warning before they click Submit.

### 3. Make the recovery session bullet‑proof
- In `ResetPasswordPage.useEffect`, also handle the `SIGNED_IN` event (GoTrue can fire `SIGNED_IN` instead of `PASSWORD_RECOVERY` when `code=` is in the URL) and re‑validate `aal` / `amr` includes `recovery`.
- Bump the wait window from 5s to 8s and surface a one‑line diagnostic if it times out (“Your reset link looks valid but the session hasn’t loaded — refreshing…”), then auto‑retry once before declaring it invalid.

### 4. Auto‑heal device lockout for verified recovery users
The whole point of clicking the email is to prove identity. So:
- On **successful** `update-password-confirmed` response, the edge fn already inserts `revoked_sessions` — also call new RPC `clear_login_rate_limit_for_user(user_id)` to wipe the server‑side bucket.
- Client clears `tfn:auth-progressive-lockout` (sessionStorage) and `tfn:reset-attempts` on success and on `PASSWORD_RECOVERY` event mount, so even if the user navigated to `/login` first, returning via the email kills the lock.
- `LoginPage` already auto‑heals ≤60s remaining; extend to **any** remaining time when `?from=password-reset` is present in the URL (redirected from the success screen).

### 5. Tests + observability
- `supabase/functions/update-password-confirmed/index.test.ts`: cover each error mapping branch.
- `src/test/ui/ResetPasswordPage.test.tsx`: add cases for `same_password`, `weak_password`, 3‑strike form lock, expired session auto‑redirect.
- New System Health card in the Auth tab: “Password reset rejections by reason (7d)” fed by `audit_log` `reason:*` tags so we can see if HIBP is the dominant rejection (i.e., we should raise complexity instead of HIBP).
- BDD `AUTH-RESET-001..006`: same_password / weak_password / expired_session / 3‑strike lock / lockout auto‑heal / pre‑submit HIBP warning.

## Files

- `supabase/functions/update-password-confirmed/index.ts` — error classifier + structured response + per‑branch audit.
- `supabase/functions/update-password-confirmed/index.test.ts` — new Deno tests.
- `supabase/migrations/<ts>_clear_login_rate_limit_for_user.sql` — SECURITY DEFINER RPC, callable by service role only.
- `src/services/auth.service.ts` — pass through `error.code` from edge fn; clear lockout artifacts on success.
- `src/pages/ResetPasswordPage.tsx` — inline errors, 3‑strike form lock, session‑expired auto‑redirect, broader auth‑event handling.
- `src/lib/auth-lockout.ts` — `clearAuthLockoutCompletely()` helper for verified‑recovery path.
- `src/pages/LoginPage.tsx` — honor `?from=password-reset` to fully drop device lockout.
- `src/pages/SystemHealthPage.tsx` + `src/services/system-health.service.ts` — “Password reset rejections by reason” card.
- `src/test/ui/ResetPasswordPage.test.tsx` — new cases.
- `bdd_scenarios` insert: AUTH‑RESET‑001..006.

## Out of scope

- Disabling HIBP (it’s a deliberate security control).
- Changing GoTrue’s server‑side rate limit thresholds.
- Replacing the recovery email template.
