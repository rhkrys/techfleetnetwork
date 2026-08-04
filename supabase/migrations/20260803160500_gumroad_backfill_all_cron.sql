-- Weekly server-side membership resync (gumroad-backfill-all).
--
-- Why: recognition is already real-time (gumroad-webhook) + self-healing on
-- login/signup (gumroad-reconcile + the profile-insert trigger), and the nightly
-- reproject fixes projection drift. This job is the belt-and-suspenders backstop
-- that pulls the FULL sales list from the Gumroad API and ingests anything those
-- paths missed (e.g. a webhook that never arrived) — with no dependency on any
-- operator's laptop. The edge function authorizes the service-role bearer in
-- code (authorizeServiceRoleRequest) and fails closed on unverifiable
-- subscriptions, so a cron run can never over-grant access.
--
-- Same Vault-secret COALESCE auth pattern proven in
-- 20260707200000_recreate_cron_jobs_on_live_project.sql. Requires pg_cron
-- (already enabled — the reproject job in 20260803120500 depends on it).
-- Sundays 09:11 UTC (offset from other jobs to avoid a thundering herd).

DO $$
DECLARE
  v_url text := 'https://pzvqxdgoztbfikfuifix.supabase.co';
  v_auth text := $auth$'Bearer ' || COALESCE(
        (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key' LIMIT 1),
        (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_service_role_key' LIMIT 1),
        (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1),
        (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SERVICE_ROLE_KEY' LIMIT 1)
      )$auth$;
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'gumroad-backfill-all-weekly';
  PERFORM cron.schedule(
    'gumroad-backfill-all-weekly',
    '11 9 * * 0',
    format($cmd$
      SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', %s),
        body := jsonb_build_object('source', 'cron', 'scheduled_at', now()),
        timeout_milliseconds := 60000
      );
    $cmd$, v_url || '/functions/v1/gumroad-backfill-all', v_auth)
  );
END $$;
