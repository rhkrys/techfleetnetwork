-- Security: re-lock SECURITY DEFINER functions that regressed to the default PUBLIC EXECUTE grant.
--
-- Root cause (Supabase advisor 0028/0029): Postgres grants EXECUTE to PUBLIC on every CREATE (OR
-- REPLACE) FUNCTION. An earlier hardening pass REVOKEd these, but later `CREATE OR REPLACE`s (e.g. to
-- add `SET search_path`) silently reset the grants — re-exposing internal functions, including an
-- *unauthenticated* PII decryption oracle (`/rest/v1/rpc/decrypt_pii`).
--
-- Scope of THIS migration (deliberately conservative):
--   1) PII crypto oracle relock (decrypt_pii/encrypt_pii).
--   2) Pure cron/service-role-only functions — verified to have NO browser caller (cross-checked
--      against every `supabase.rpc("…")` in src/). Only pg_cron (as postgres) and edge functions
--      (service_role) invoke them, so revoking anon/authenticated is safe.
--
-- Explicitly NOT here (tracked as follow-up, would break things if revoked):
--   * Admin-UI-called-but-unguarded fns (get_email_outbox, run_auto_remediations, set_fix_queue_status,
--     pause_email_lane, …) — these need an internal `is_elevated()` guard, NOT a revoke.
--   * Auth-frozen fns (record_failed_login, _login_hash, _consume_device_nonce, all rate-limit
--     machinery, use_invitation) — several must stay anon-callable for the login/signup flow.

-- ── 1. PII crypto oracle ─────────────────────────────────────────────────────
-- encrypt_pii: only ever driven by DEFINER triggers (run as postgres) + service_role → no direct caller.
REVOKE ALL     ON FUNCTION public.encrypt_pii(text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.encrypt_pii(text) TO service_role;
-- decrypt_pii: the admin `*_decrypted` views are security_invoker + admin-only RLS, so an admin
-- (authenticated) legitimately needs EXECUTE; anon must never. (A follow-up adds an internal
-- is_elevated() guard so non-admin authenticated users can't call it directly either.)
REVOKE ALL     ON FUNCTION public.decrypt_pii(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.decrypt_pii(text) TO authenticated, service_role;

-- ── 2. Pure cron / service-role-only functions ──────────────────────────────
DO $$
DECLARE
  fn   text;
  r    record;
  -- Every name below is SECURITY DEFINER and appears in NO src/ rpc() call. Grouped by subsystem.
  names text[] := ARRAY[
    -- Resend email pipeline (queue drain / reconcile / rollups) — not auth-login email
    'claim_due_emails','read_email_batch','delete_email','set_email_visibility_timeout',
    'reconcile_stuck_emails','record_email_attempt_result','gc_expired_email_outbox',
    'cleanup_stuck_email_queue','prune_email_send_log','refresh_email_health_snapshot',
    'email_v2_daily_rollup','email_v2_lane_metrics','email_message_ids_in_queue',
    'email_send_log_latest_failed','email_send_log_latest_stuck','compute_email_domain_health',
    'consume_workspace_email_token','record_workspace_email_429','record_workspace_email_success',
    'enqueue_email_v2','notify_admins_email_dlq_escalation','expire_stale_pending_v2',
    -- notification fanout
    'drain_notification_outbox','drain_notification_fanout_jobs','process_notification_fanout_chunk',
    'list_pending_fanout_jobs','retry_stuck_fanout_jobs','safe_create_notification',
    -- pgmq plumbing
    'pgmq_archive_delete','pgmq_read_archive','move_to_dlq',
    -- freescout support-ticket workers
    'freescout_dequeue_events','freescout_enqueue_event','freescout_send_to_dlq',
    'enqueue_freescout_provisioning',
    -- discord role-grant workers
    'queue_discord_role_grant','retry_pending_discord_role_grants','mark_discord_role_grant_result',
    -- maintenance / retention crons (non-auth)
    'archive_old_fix_queue','purge_old_audit_logs','enforce_retention_policy',
    'reconcile_account_orphans','reproject_membership_drift','recompute_all_stats',
    'resolve_stale_fingerprints_on_deploy','discover_audit_fingerprints','get_nudgeable_quest_users',
    'cleanup_chunk_load_noise',
    -- internal helpers + internal audit writers (NOT public.write_audit_log, which the app calls)
    'try_write_audit_log','write_audit_log_batch','is_actionable_event_type','is_remediation_allowed'
  ];
BEGIN
  FOREACH fn IN ARRAY names LOOP
    FOR r IN
      SELECT p.oid::regprocedure AS sig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = fn AND p.prosecdef
    LOOP
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
      RAISE NOTICE 're-locked %', r.sig;
    END LOOP;
  END LOOP;
END $$;
