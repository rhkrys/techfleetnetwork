# Investigation: have signups actually stopped today?

## Evidence — signups are NOT stopped

Pulled signup volume from `auth.users.created_at` for the last 72h:

| Date (UTC) | Signups |
|---|---|
| 2026-06-01 | 21 |
| 2026-06-02 | 10 |
| 2026-06-03 | **25** |
| 2026-06-04 (first 16 min) | 0 |

Today (Jun 3 UTC) is the **highest** signup day of the week. The most recent confirmed signup is `efonseca318@gmail.com` at **23:48 UTC** — about 30 minutes before this investigation. Hourly cadence on Jun 3 looked normal: 21:00=3, 22:00=1, 23:00=2.

## Health checks — everything green

- `auth.users` count = `profiles` count = 628 (0 users without a profile → the `handle_new_user` trigger is firing on every signup)
- Auth logs in the last 12h show no 5xx, no signup endpoint errors — only the routine `bad_jwt` 403s from anonymous page loads (expected, harmless)
- All 15 most-recent signups are `confirmed_at` populated → email confirmation hook is delivering
- No correlation with the freescout-proxy fix shipped 30 min ago (that path is post-signup, not blocking)

## Conclusion

There is no signup outage to fix. Shipping a "permanent fix" without a real root cause would be a band-aid against an imaginary failure, which violates the no-band-aid rule.

## What I need from you before changing anything

Can you share the specific signal that made you think signups stopped? For example:
- A member who told you they tried to sign up and got a specific error message (and roughly when)
- A dashboard/report you're looking at that shows zero
- A specific email domain or path (e.g. Google sign-in vs email/password)

With one concrete failing case (email + approximate time, or screenshot of the error), I can trace it through `auth_logs` → `handle_new_user` trigger → `auth-email-hook` → `process-email-queue` and ship the real root-cause fix in one turn. Without it, there's nothing broken to fix.
