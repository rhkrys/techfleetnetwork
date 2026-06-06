---
name: Password Reset Chain Permanent Fix
description: 8-layer hardening that prevents /reset-password "service unavailable" caused by missing recovery session, swallowed pre-auth telemetry, and stale append-only email status
type: feature
---

End-to-end chain that MUST stay intact. Removing any layer reintroduces the multi-day outage.

1. **Hard recovery proof gate** (`src/pages/ResetPasswordPage.tsx`): every branch (token_hash → verifyOtp, code → exchangeCodeForSession, hash → setSession + getUser) must produce a session visible to `getSession()` before `validRecovery=true`. `handleSubmit` re-confirms via `confirmActiveRecoverySession()` before calling `updateUser`.
2. **Error classification** (`src/services/auth.service.ts`): `Auth session missing`, `Session not found`, `user_not_found`, `user_not_authenticated`, `invalid claim`, `JWT expired`, `User from sub claim in jwt does not exist` → `session_expired`. ONLY genuine network/5xx → `service_unavailable`.
3. **Pre-auth public telemetry** (`supabase/functions/record-auth-recovery`, `src/lib/auth/reset-telemetry.ts`): explicitly public edge fn, no PII, writes via `record_event` to `ops_events`. Mounted on every branch incl. `update_submit` outcomes.
4. **Email health latest-status RPCs** (`get_recovery_email_health`, `get_email_send_latest`, `email_send_log_latest` view): collapse by `message_id`; append-only `pending` rows never count as failures.
5. **Fail-loud link rewrite** (`supabase/functions/auth-email-hook`): `recoveryRewriteOk` flag; if rewrite fails, beacon `auth.recovery_link.unsafe_shape` severity=error.
6. **Regression tests** (`src/test/ui/ResetPasswordPage.test.tsx`, `src/test/services/auth.service.test.ts`): AUTH-RESET-SESSION-001..006 cover null-session-after-success, getUser failure, JWT/sub-claim errors classified as session_expired.
7. **Smoke monitor** (`supabase/functions/auth-reset-smoke`, pg_cron every 30 min): probes beacon + identity gate + email health; writes `auth.reset_smoke.ok|failed` to `ops_events`. Failures hit Triage via severity=error.
8. **Admin surface** (`src/components/system-health/ResetHealthTab.tsx`, System Health → Password reset tab): live view of email health, last 10 smoke runs, recent beacon outcomes per branch. Admin no longer needs psql to diagnose.

BDD: AUTH-RESET-SESSION-001..006 in `public.bdd_scenarios`.

**Why:** Logs were empty during the outage because `write_audit_log` requires auth; the failing branch was exactly the unauth recovery handoff. Future telemetry for reset MUST go through `record-auth-recovery` (public) — never auth-bound writers.
