
## What the data shows

I pulled `ops_events` for the last 3 days and the pattern is unambiguous.

Example sequence from 2026-06-09 18:24–18:26 (one member, two devices):

```text
18:24:41  Android  ip A   token_hash.ok          ← reset link opened on phone, token consumed
18:24:48  Windows  ip B   token_hash.verify_error ← SAME link clicked from desktop / email scanner → 2nd use rejected
18:25:25  Android  ip A   update_success         ← new password actually saved on phone
18:26:39  Android  ip A   token_hash.verify_error ← user tapped the email link again → already consumed
18:26:47  Windows  ip B   token_hash.verify_error ← desktop retry → still consumed
```

The same shape repeats on 2026-06-08 22:28 and earlier. The user is the one I've been seeing in chat.

### Why this produces both symptoms

1. **"Verification failed" on the reset link** — Supabase recovery `token_hash` is single-use. The first click (often by an email security scanner like Outlook SafeLinks / Proofpoint, or by the user opening the email on a second device) consumes it. Every later click — including the user's "real" click — returns `verify_error`, which our `/reset-password` page surfaces as "verification failed."

2. **"Wrong password" loop on login** — In the 18:24 sequence the password DID save (`update_success` at 18:25:25 on Android). But after the user then sees `verify_error` from clicking the email link a second time at 18:26, they reasonably conclude the reset failed and either (a) request another reset and type a third password, or (b) try logging in with the password they THINK is current — which is whichever device they last typed in. The two password mutations from two devices collide and the user can't tell which one "won."

3. **"Verification failed" on login** — separately, the Turnstile widget's `error-callback` and the server-side `verify-turnstile` 403 both render the same generic copy. Members on Brave Shields / corporate VPN / iOS Lockdown Mode hit this and have no way to tell it apart from a bad password.

So: not one bug — one root cause (single-use token consumed by a non-human pre-fetch) plus one UX collision (two unrelated failures share the same error string).

---

## Permanent fix

### A. Stop link pre-fetchers from burning the user's recovery token

1. **Two-step recovery landing page.** Change the email link to point at `/reset-password/confirm?token_hash=…` which renders a "Continue resetting your password" button. The actual `verifyOtp({token_hash})` call only fires on the user's click — so HEAD/GET prefetchers from SafeLinks/Proofpoint, link-preview crawlers, and Slack/iMessage unfurlers do NOT consume the token. This is the canonical Supabase recommendation for this exact failure mode.
2. **Idempotent verify with grace window.** When `verifyOtp` returns `verify_error` AND we already have a recovery session in storage for the same email within the last 10 minutes, skip the re-verify and let the user proceed to set their new password. Pure client-side; no DB change.
3. **`Cache-Control: no-store` + `X-Robots-Tag: noindex` on `/reset-password*`** so corporate proxies don't cache or re-fetch.

### B. Disambiguate the three "verification failed" sources

Today every failure mode renders the same string. Fix:

| Source | New copy | Recovery action shown |
|---|---|---|
| Turnstile widget error | "Human verification didn't load — extension or VPN may be blocking it." | Retry + magic-link button (already exists) |
| `verify-turnstile` 403 | "Human check expired — please complete the box again." | Refresh widget |
| Recovery `verify_error` (link already used) | "This reset link has already been used. Request a new one if you still need to change your password." | "Send a new reset link" button |
| Recovery `verify_error` (link expired) | "Reset link expired (1 hour limit). Request a new one." | "Send a new reset link" button |

Done by branching on the error code we already classify in `auth-classifier.ts` + the `outcome` we already emit to `record-auth-recovery`.

### C. Prevent the two-device password collision

When `update_success` fires, also:

- Sign out **all other sessions** for that user via `supabase.auth.admin.signOut(user_id, 'others')` (server-side from the same edge fn that handles the update). So if Android saved the new password at 18:25, the desktop session can't keep trying the old one.
- Show a final-screen confirmation: "Password updated on this device. You're signed in here — every other browser will need the new password."

### D. Observability so we catch this next time without asking the user

- Add `auth.recovery.token_hash.verify_error` to the System Health Triage tab severity gate as `warn` when seen ≥2× from distinct IPs within 5 minutes for the same `token_hash` prefix (already hashed so PII-safe). That's the prefetcher fingerprint.
- Beacon `recovery_link_prefetch_suspected` and surface a count in the existing Auth Funnel widget.

---

## What I will NOT touch

- The Turnstile sitekey / Cloudflare allowlist (already correct for all 3 prod hosts).
- The XState auth machine — failures stay typed; only the rendered copy and the landing page change.
- The email subsystem v2 refactor.

## Technical surface

- `src/pages/ResetPasswordPage.tsx` → split into `ConfirmRecoveryLinkPage` (button) + existing form page.
- `src/features/auth/flows/consume-recovery-link.flow.ts` → add the 10-minute grace branch.
- `src/features/auth/ui/AuthErrorMessage.tsx` → 4-way branch on the new outcome codes.
- `supabase/functions/auth-email-hook/_shared/email-templates/recovery.tsx` → point button at `/reset-password/confirm`.
- New edge fn `supabase/functions/finalize-password-reset/index.ts` → wraps `updateUser({password})` + `admin.signOut(..., 'others')`.
- `public/_headers` → `Cache-Control: no-store` and `X-Robots-Tag: noindex` for `/reset-password*`.
- 5 new BDD scenarios under `AUTH-RESET-*`.

Ship as one PR; no DB migration required.
