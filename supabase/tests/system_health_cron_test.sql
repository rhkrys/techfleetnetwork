-- pgTAP suite for the System Health cron/reconciler backend (Wave 0).
-- Run: `supabase db test` against a DB with the migrations applied.
--
-- This is the BEHAVIOR test that the prior string-grep "smoke" test lacked: it
-- asserts the reconciler + pager crons are actually SCHEDULED and ACTIVE (the
-- exact state that was false on the live project), that environment_readiness()
-- now covers the reconciler, and that reconcile_stuck_emails() resolves a lost
-- stuck row. Everything runs in a rolled-back transaction.

BEGIN;
SELECT plan(5);

-- ── 1-2. The two crons lost at cutover are scheduled + active ───────────────
SELECT ok(
  EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'reconcile-stuck-emails' AND active),
  'reconcile-stuck-emails cron is scheduled and active (regression guard for the cutover gap)');

SELECT ok(
  EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'triage-critical-push' AND active),
  'triage-critical-push cron is scheduled and active (critical-alert push path)');

-- ── 3. environment_readiness() now MONITORS the reconciler (never "missing") ─
-- service_role claim satisfies the admin guard in a non-JWT test session.
SET LOCAL "request.jwt.claims" = '{"role":"service_role"}';
SELECT ok(
  EXISTS (
    SELECT 1 FROM public.environment_readiness()
    WHERE category = 'cron_job' AND item = 'reconcile-stuck-emails' AND status <> 'missing'
  ),
  'environment_readiness() lists reconcile-stuck-emails as a monitored cron and does not report it missing');

-- ── 4-5. reconcile_stuck_emails() resolves a genuinely-lost stuck row ────────
-- A >10-min-old pending row with no queue entry and no payload → DLQ (lost).
INSERT INTO public.email_send_log (message_id, template_name, recipient_email, status, created_at)
VALUES ('pgtap-stuck-lost-1', 'signup', 'stuck-lost@example.com', 'pending', now() - interval '20 minutes');

SELECT is(
  (public.reconcile_stuck_emails() ->> 'dlq_lost')::int,
  1,
  'reconcile_stuck_emails() dead-letters a lost stuck pending row (no queue entry, no payload)');

-- ── 5. Idempotent: a second pass finds nothing (latest status is now dlq) ────
SELECT is(
  (public.reconcile_stuck_emails() ->> 'checked')::int,
  0,
  'reconcile_stuck_emails() is idempotent — the reconciled row is no longer counted stuck');

SELECT * FROM finish();
ROLLBACK;
