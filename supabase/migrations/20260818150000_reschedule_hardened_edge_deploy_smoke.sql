-- Reschedule the deploy smoke-test cron, now that its probe is reliability-
-- hardened. INCIDENT edge-deploy-smoke-false-alarms-2026-08: the job
-- 'edge-deploy-smoke-10min' was unscheduled during incident response because it
-- had flooded audit_log with 36,270 false `edge_function_not_deployed` rows
-- (91% of the entire log) and even libeled the live handoff-worker.
--
-- The function (supabase/functions/edge-deploy-smoke) now classifies probes via
-- probe.ts: transient timeouts and OPTIONS-ambiguous 404s are `inconclusive`
-- and never page; only a JWT-gated function whose gateway returns 404 is a
-- confirmed `missing`. Safe to run again.
--
-- Idempotent + portable: pg_cron-guarded, unschedule-if-exists then schedule,
-- service-role key resolved from Vault (mirrors 20260606000408 / 20260707200000).
DO $$
DECLARE
  v_url text := 'https://pzvqxdgoztbfikfuifix.supabase.co/functions/v1/edge-deploy-smoke';
  v_key text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not installed; skipping edge-deploy-smoke-10min schedule';
    RETURN;
  END IF;

  SELECT COALESCE(
    (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1),
    (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SERVICE_ROLE_KEY' LIMIT 1),
    (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key' LIMIT 1)
  ) INTO v_key;

  IF v_key IS NULL THEN
    RAISE NOTICE 'service_role_key not in vault; skipping edge-deploy-smoke-10min schedule';
    RETURN;
  END IF;

  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'edge-deploy-smoke-10min';

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
