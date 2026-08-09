-- Wave 1a · Restore the resend-signup-confirmations safety-net schedule.
--
-- resend-signup-confirmations generates a FRESH confirmation link for users who
-- registered but never confirmed (10 min – 14 day window), rate-limited to 1 per
-- tick with a 30-min per-user gap and a 4-reminder cap. It is the self-heal for
-- signups that were enqueued during a dispatch outage and stranded (e.g. the 2
-- users found 2026-08-09). Like the reconciler, its cron was never recreated at
-- the cutover, so the safety net wasn't running.
--
-- Service-role gated (the function compares the bearer to SUPABASE_SERVICE_ROLE_KEY);
-- invoked via the same Vault-secret Bearer pattern as the other service-role
-- crons in 20260707200000. Portable + pg_cron-guarded.
--
-- Cadence: every 15 min. With MAX_PER_CYCLE=1 that clears a backlog at ~4/hour
-- while respecting the function's own burst controls — tunable here.

DO $$
DECLARE
  v_url  text := 'https://pzvqxdgoztbfikfuifix.supabase.co';
  v_auth text := $auth$'Bearer ' || COALESCE(
        (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key' LIMIT 1),
        (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_service_role_key' LIMIT 1),
        (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1),
        (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SERVICE_ROLE_KEY' LIMIT 1)
      )$auth$;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not installed; skipping resend-signup-confirmations schedule';
    RETURN;
  END IF;

  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'resend-signup-confirmations-15m';

  PERFORM cron.schedule(
    'resend-signup-confirmations-15m',
    '*/15 * * * *',
    format($cmd$
      SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', %s),
        body := jsonb_build_object('source', 'cron', 'scheduled_at', now())
      );
    $cmd$, v_url || '/functions/v1/resend-signup-confirmations', v_auth)
  );
END
$$;
