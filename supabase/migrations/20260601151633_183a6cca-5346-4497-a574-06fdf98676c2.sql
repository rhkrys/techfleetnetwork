-- REPAIR (audit H3/H4, 2026-08-08): originally a bare `SELECT cron.alter_job(
-- job_id := (SELECT jobid ...))`, which passes NULL and errors ("job_id can not
-- be NULL") on a fresh `supabase db reset` where the cron job doesn't exist yet.
-- Guarded so it skips cleanly on any env without the job (fresh/CI/new-project);
-- unchanged effect where the job exists. (Note the OLD project URL below — this
-- is an obsolete Lovable-era rewire, superseded by later cron recreation.)
DO $$
DECLARE
  v_job_id bigint;
BEGIN
  SELECT jobid INTO v_job_id FROM cron.job WHERE jobname = 'process-email-queue';
  IF v_job_id IS NULL THEN
    RAISE NOTICE 'cron job process-email-queue not present; skipping alter_job (fresh/CI/new-project env)';
    RETURN;
  END IF;

  PERFORM cron.alter_job(
    job_id := v_job_id,
    command := $cmd$
    SELECT CASE
      WHEN (SELECT retry_after_until FROM public.email_send_state WHERE id = 1) > now()
        THEN NULL
      WHEN EXISTS (SELECT 1 FROM pgmq.q_auth_emails LIMIT 1)
        OR EXISTS (SELECT 1 FROM pgmq.q_transactional_emails LIMIT 1)
        OR EXISTS (SELECT 1 FROM pgmq.q_bulk_emails LIMIT 1)
        THEN net.http_post(
          url := 'https://iqsjhrhsjlgjiaedzmtz.supabase.co/functions/v1/process-email-queue',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || (
              SELECT decrypted_secret FROM vault.decrypted_secrets
              WHERE name = 'email_queue_service_role_key'
            )
          ),
          body := '{}'::jsonb
        )
      ELSE NULL
    END;
    $cmd$
  );
END $$;
