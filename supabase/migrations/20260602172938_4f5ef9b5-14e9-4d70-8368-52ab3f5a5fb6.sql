-- Remove both broken cron jobs (uppercase vault name lookup that returns NULL).
SELECT cron.unschedule('process-freescout-events-15s');
SELECT cron.unschedule('process-freescout-events-every-15s');

-- Recreate a single canonical job using the same vault-lookup pattern as
-- prewarm-ugc-worker (verified working in production). The COALESCE chain
-- survives future Supabase key-name conventions without another 401 storm.
SELECT cron.schedule(
  'process-freescout-events-every-15s',
  '15 seconds',
  $job$
  SELECT net.http_post(
    url := 'https://iqsjhrhsjlgjiaedzmtz.supabase.co/functions/v1/process-freescout-events',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || COALESCE(
        (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_service_role_key' LIMIT 1),
        (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY' LIMIT 1),
        (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1),
        (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key' LIMIT 1)
      )
    ),
    body := jsonb_build_object('source', 'cron'),
    timeout_milliseconds := 25000
  );
  $job$
);