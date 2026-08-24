-- PR 6c (email rearchitecture): stale-claim reaper + cron schedule for the Email Octopus worker.
--
-- The worker claims a row (status 'pending' -> 'syncing') before pushing to EO. If it dies after
-- claiming but before settling, the row would sit in 'syncing' forever (claim only picks 'pending').
-- reclaim_stale_eo_sync returns such rows to 'pending' so they are retried. The worker calls it at
-- the start of every run.

CREATE OR REPLACE FUNCTION public.reclaim_stale_eo_sync(p_older_than_secs integer DEFAULT 300)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n integer;
BEGIN
  UPDATE public.email_octopus_contact_sync
     SET status = 'pending', next_attempt_at = now(), claimed_at = NULL, updated_at = now()
   WHERE status = 'syncing'
     AND claimed_at IS NOT NULL
     AND claimed_at < now() - make_interval(secs => p_older_than_secs);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public.reclaim_stale_eo_sync(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reclaim_stale_eo_sync(integer) TO service_role;

-- Schedule the worker every 2 minutes (opt-out -> EO propagation SLO p95 < 5 min). Follows the repo's
-- net.http_post + Vault pattern; the Vault lookup runs at job-run time (inside the command string), so
-- this applies even where Vault/pg_net are absent — hence the extension guards.
DO $$
DECLARE
  v_url  text := 'https://pzvqxdgoztbfikfuifix.supabase.co';
  v_auth text := $auth$'Bearer ' || COALESCE(
      (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key' LIMIT 1),
      (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1),
      (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SERVICE_ROLE_KEY' LIMIT 1)
    )$auth$;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not installed; skipping email-octopus-sync schedule'; RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RAISE NOTICE 'pg_net not installed; skipping email-octopus-sync schedule'; RETURN;
  END IF;

  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'email-octopus-sync';
  PERFORM cron.schedule(
    'email-octopus-sync',
    '*/2 * * * *',
    format($cmd$
      SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', %s),
        body := jsonb_build_object('source', 'cron'),
        timeout_milliseconds := 60000
      );
    $cmd$, v_url || '/functions/v1/email-octopus-sync', v_auth)
  );
END $$;
