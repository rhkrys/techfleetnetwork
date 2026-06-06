## Findings

- Google-only accounts do not have a platform password to reset. Google owns that password, so the app must never call the platform password reset service for Google-only accounts.
- Recent recovery emails are being enqueued and sent successfully. The verified sender domain and queue are working.
- The current risk is before email delivery: account identity checks and password-reset rate limits can still route the wrong account type into the password reset service or poison shared login/reset buckets.
- The account identity endpoint currently uses the `login_attempt` rate-limit bucket for identity probes. That means harmless “is this Google-only?” checks can count like login failures. That is exactly the kind of cross-contamination that creates “too many requests” and confusing recovery loops.
- The forgot-password page records a password-reset failure for broad catch paths, even when the failure may be service/identity-resolution noise instead of a confirmed abusive reset attempt.

## Permanent fix plan

1. **Separate account identity probing from login attempts**
   - Add a dedicated backend rate-limit action for account identity lookups.
   - Update the account identity endpoint to use that bucket, never `login_attempt`.
   - Keep enumeration protection, but stop identity probes from locking people out of login.

2. **Make provider type the reset gate**
   - For Google-only accounts: show “Use Google sign-in” and do not call password reset.
   - For email-password accounts: allow platform password reset normally.
   - For hybrid accounts with both Google and email password: allow password reset, because the platform password exists.
   - For unknown identity lookup failures: fail safe with generic success only when needed for privacy, but do not burn user-facing reset attempts.

3. **Fix reset rate-limit accounting**
   - Only increment the app’s `password_reset` failure bucket on confirmed abuse/rejection.
   - Do not increment it for service unavailable, network, identity lookup fallback, duplicate submit, or provider mismatch.
   - Clear stale password-reset rows that were created by the old behavior so affected members are not stuck for 60 minutes.

4. **Improve user-facing messages without leaking account existence**
   - Google-only: “This account uses Google sign-in. Use Google to continue.”
   - Email-password successful request: “If an account exists, we sent a reset link.”
   - Service unavailable: show a temporary service message without counting it against the member.
   - Rate-limited: reserve this only for real backend rate limits, not local bookkeeping noise.

5. **Add regression coverage**
   - Tests for Google-only reset never calling the reset service.
   - Tests for email-password reset calling the reset service.
   - Tests for identity lookup not touching `login_attempt`.
   - Tests proving transient reset errors do not increment `password_reset` lockout.
   - BDD scenarios covering UI, database, and code/API expected results.

6. **Verify live behavior**
   - Probe a known Google-only account: identity returns Google-only and reset is blocked before service call.
   - Probe a known email-password account: identity returns password-capable and reset email sends.
   - Confirm recent recovery email logs still show sent status.
   - Confirm no active `password_reset` or polluted `login_attempt` blocks remain from this flow.