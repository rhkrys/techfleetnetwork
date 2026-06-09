
-- Schedule the synthetic auth prober every 5 minutes.
-- Pattern matches other cron-poked workers (process-email-queue, process-freescout-events).
DO $$
DECLARE
  v_jobid bigint;
  v_project_ref text := 'iqsjhrhsjlgjiaedzmtz';
BEGIN
  -- Idempotent: unschedule if already present so we can re-create with current SQL.
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'auth-prober-5min';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;

  PERFORM cron.schedule(
    'auth-prober-5min',
    '*/5 * * * *',
    format($cmd$
      SELECT net.http_post(
        url := 'https://%s.supabase.co/functions/v1/auth-prober',
        headers := jsonb_build_object(
          'content-type', 'application/json',
          'authorization', 'Bearer ' || COALESCE(
            (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1),
            (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SERVICE_ROLE_KEY' LIMIT 1),
            (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key' LIMIT 1)
          )
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 60000
      );
    $cmd$, v_project_ref)
  );
END $$;
