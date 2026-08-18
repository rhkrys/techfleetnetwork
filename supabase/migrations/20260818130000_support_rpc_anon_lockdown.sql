-- Security (03 DB/RLS): lock the SECURITY DEFINER support-ticketing RPC surface.
--
-- Root cause (same as advisor 0028/0029 addressed in 20260818120000 for other
-- subsystems): Postgres grants EXECUTE to PUBLIC on every CREATE OR REPLACE
-- FUNCTION, and Supabase's default privileges grant EXECUTE to anon+authenticated.
-- The support hardening pass (20260804170000) REVOKEd from PUBLIC on some fns but
-- not from `anon` directly, so `support_list_agents` and `support_backfill_
-- provisioning` remained anon-EXECUTE-able (verified live 2026-08-18). They are
-- internally admin-gated (they RAISE insufficient_privilege for a null auth.uid()),
-- so there is no data leak — but no anonymous caller is ever legitimate for a
-- support feature that requires sign-in, so we remove the grant (defense in depth).
--
-- This migration is deliberately support-scoped and idempotent (REVOKE/GRANT),
-- so it composes cleanly with the broader 20260818120000 relock when that merges.
--
--   * anon  -> revoked from EVERY support_/freescout_ SECURITY DEFINER function.
--   * authenticated -> revoked from the service-role-only workers (no browser
--     rpc() caller; invoked only by pg_cron/postgres, service_role edge fns, or
--     DEFINER triggers). Cross-checked: none appear in a supabase.rpc("…") call.
--   * KEPT for authenticated (the admin UI / triage grid call these as the signed-in
--     admin; each self-guards with has_role): support_list_agents,
--     support_backfill_provisioning, support_check_rate_limit(_for),
--     get_support_monthly_report, get_support_category_report.

DO $$
DECLARE
  r record;
  -- service-role-only support/freescout workers (no direct browser caller)
  internal text[] := ARRAY[
    'freescout_dequeue_events','freescout_enqueue_event','freescout_delete_event',
    'freescout_send_to_dlq','enqueue_freescout_provisioning','support_pending_provisioning',
    'support_prune_webhook_events','refresh_support_monthly_report'
  ];
BEGIN
  -- 1. No anonymous caller is ever legitimate for support. Revoke from PUBLIC (not
  --    just anon): Postgres grants EXECUTE to PUBLIC on every CREATE, and anon
  --    inherits execute THROUGH PUBLIC — a bare `REVOKE FROM anon` leaves the
  --    PUBLIC grant intact so has_function_privilege('anon',…) stays true. The
  --    functions that authenticated legitimately needs keep their explicit
  --    GRANT TO authenticated (from 20260804170000), so revoking PUBLIC is safe.
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.prosecdef
      AND (p.proname LIKE 'support\_%' OR p.proname LIKE '%freescout%'
           OR p.proname IN ('get_support_monthly_report','get_support_category_report'))
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', r.sig);
  END LOOP;

  -- 2. Internal workers: strip authenticated too, keep service_role only.
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.prosecdef
      AND p.proname = ANY(internal)
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END $$;
