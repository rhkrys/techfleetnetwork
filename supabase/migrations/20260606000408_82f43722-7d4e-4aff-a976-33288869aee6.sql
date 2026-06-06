DO $$
DECLARE
  v_url text := 'https://iqsjhrhsjlgjiaedzmtz.supabase.co/functions/v1/edge-deploy-smoke';
  v_key text;
BEGIN
  SELECT COALESCE(
    (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1),
    (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SERVICE_ROLE_KEY' LIMIT 1),
    (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key' LIMIT 1)
  ) INTO v_key;

  IF v_key IS NULL THEN
    RAISE NOTICE 'service_role_key not in vault; skipping cron schedule';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'edge-deploy-smoke-10min') THEN
    PERFORM cron.unschedule('edge-deploy-smoke-10min');
  END IF;

  PERFORM cron.schedule(
    'edge-deploy-smoke-10min',
    '*/10 * * * *',
    format($cmd$
      SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || %L),
        body := '{}'::jsonb,
        timeout_milliseconds := 30000
      );
    $cmd$, v_url, v_key)
  );
END $$;