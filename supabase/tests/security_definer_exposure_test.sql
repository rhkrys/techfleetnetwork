-- pgTAP: SECURITY DEFINER exposure guard.
-- Prevents the regression that reopened decrypt_pii: a later CREATE OR REPLACE silently resets grants
-- to the PUBLIC default, re-exposing an internal function to anon. This test fails the build if any
-- function in the locked set becomes anon-executable again. Run: supabase db test.
BEGIN;
SELECT plan(13);

-- ── PII crypto oracle: anon must never decrypt/encrypt; encrypt has no authenticated caller ──
SELECT ok(NOT has_function_privilege('anon',          'public.decrypt_pii(text)', 'EXECUTE'), 'anon cannot execute decrypt_pii');
SELECT ok(NOT has_function_privilege('anon',          'public.encrypt_pii(text)', 'EXECUTE'), 'anon cannot execute encrypt_pii');
SELECT ok(NOT has_function_privilege('authenticated', 'public.encrypt_pii(text)', 'EXECUTE'), 'authenticated cannot execute encrypt_pii');
-- decrypt_pii stays available to admins (security_invoker views) + service_role, but never anon.
SELECT ok(    has_function_privilege('service_role',  'public.decrypt_pii(text)', 'EXECUTE'), 'service_role can execute decrypt_pii');

-- ── A representative slice of the pure cron/service-role-only set: anon locked, service_role kept ──
-- (One assertion per subsystem; expand as the locked list grows.)
SELECT ok(NOT bool_or(has_function_privilege('anon', p.oid, 'EXECUTE')), 'anon cannot execute drain_notification_outbox')
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='drain_notification_outbox' AND p.prosecdef;
SELECT ok(NOT bool_or(has_function_privilege('anon', p.oid, 'EXECUTE')), 'anon cannot execute claim_due_emails')
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='claim_due_emails' AND p.prosecdef;
SELECT ok(NOT bool_or(has_function_privilege('anon', p.oid, 'EXECUTE')), 'anon cannot execute move_to_dlq')
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='move_to_dlq' AND p.prosecdef;
SELECT ok(NOT bool_or(has_function_privilege('anon', p.oid, 'EXECUTE')), 'anon cannot execute purge_old_audit_logs')
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='purge_old_audit_logs' AND p.prosecdef;
SELECT ok(NOT bool_or(has_function_privilege('anon', p.oid, 'EXECUTE')), 'anon cannot execute reconcile_stuck_emails')
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='reconcile_stuck_emails' AND p.prosecdef;
SELECT ok(NOT bool_or(has_function_privilege('anon', p.oid, 'EXECUTE')), 'anon cannot execute freescout_dequeue_events')
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='freescout_dequeue_events' AND p.prosecdef;
SELECT ok(NOT bool_or(has_function_privilege('anon', p.oid, 'EXECUTE')), 'anon cannot execute queue_discord_role_grant')
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='queue_discord_role_grant' AND p.prosecdef;
SELECT ok(    bool_or(has_function_privilege('service_role', p.oid, 'EXECUTE')), 'service_role can execute drain_notification_outbox')
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='drain_notification_outbox' AND p.prosecdef;

-- ── Guard against the actual regression vector: these must NOT be anon-callable (the app never calls them by anon) ──
SELECT ok(NOT bool_or(has_function_privilege('anon', p.oid, 'EXECUTE')), 'anon cannot execute write_audit_log_batch')
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='write_audit_log_batch' AND p.prosecdef;

SELECT * FROM finish();
ROLLBACK;
