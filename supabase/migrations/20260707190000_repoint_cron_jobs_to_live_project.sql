-- CRITICAL: repoint every cron job that still calls the dead Lovable-era
-- project (iqsjhrhsjlgjiaedzmtz) instead of the live owned project
-- (pzvqxdgoztbfikfuifix). No migration ever corrected these after the
-- Supabase cutover — they have been silently no-op-ing (POSTing to a
-- project that isn't this one) since day one on the new project.
--
-- Concretely, this is why an application-confirmation email could be
-- "enqueued" (log: "Transactional email enqueued") and never delivered:
-- the enqueue path succeeds locally (pgmq insert), but the workers that
-- drain the queue and actually call the email provider — the
-- 'process-email-queue' cron job AND the 'app-confirmation-sweeper' safety
-- net — were both POSTing to the OLD, unrelated project. Same root cause
-- silently degraded several other cron-poked systems: DLQ replay, ops
-- digests/critical-push alerts, the email pipeline health monitor,
-- community events refresh, UGC prewarming, Freescout event draining,
-- deploy smoke checks, and the synthetic auth prober.
--
-- Fix: for every cron.job whose command references the dead host, rewrite
-- it in place via cron.alter_job (the supported API — never touches
-- unrelated jobs, since the WHERE clause only matches the stale host
-- string). Idempotent: running this again when nothing matches is a no-op.
DO $$
DECLARE
  r RECORD;
  v_fixed int := 0;
BEGIN
  FOR r IN
    SELECT jobid, command
    FROM cron.job
    WHERE command LIKE '%iqsjhrhsjlgjiaedzmtz%'
  LOOP
    PERFORM cron.alter_job(
      job_id  := r.jobid,
      command := replace(r.command, 'iqsjhrhsjlgjiaedzmtz', 'pzvqxdgoztbfikfuifix')
    );
    v_fixed := v_fixed + 1;
  END LOOP;

  RAISE NOTICE 'repoint_cron_jobs_to_live_project: repointed % cron.job row(s)', v_fixed;
END $$;

-- kick_community_events_refresh() embeds the project URL directly in its
-- function body (it's called BY a cron job — 'refresh-community-events' —
-- rather than the URL living in cron.job.command itself), so the loop above
-- cannot reach it. Same fix, applied as CREATE OR REPLACE FUNCTION.
CREATE OR REPLACE FUNCTION public.kick_community_events_refresh()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, extensions, pg_net
AS $$
DECLARE
  v_url TEXT := 'https://pzvqxdgoztbfikfuifix.supabase.co';
  v_key TEXT;
  v_err TEXT;
BEGIN
  BEGIN
    -- Reuse the service-role key already provisioned for the email queue worker.
    SELECT decrypted_secret INTO v_key
      FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key' LIMIT 1;
    IF v_key IS NULL THEN
      SELECT decrypted_secret INTO v_key
        FROM vault.decrypted_secrets WHERE name = 'supabase_service_role_key' LIMIT 1;
    END IF;
    IF v_key IS NULL THEN
      SELECT decrypted_secret INTO v_key
        FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
  END;

  IF v_key IS NULL OR v_err IS NOT NULL THEN
    UPDATE public.community_events_cache
      SET last_refresh_status = 'config_error',
          last_refresh_error  = COALESCE(v_err, 'service-role key not available in vault'),
          updated_at          = now()
      WHERE id = 1;
    RETURN;
  END IF;

  BEGIN
    PERFORM net.http_post(
      url     := v_url || '/functions/v1/refresh-community-events',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || v_key
      ),
      body    := jsonb_build_object('source', 'cron', 'at', now()),
      timeout_milliseconds := 30000
    );
  EXCEPTION WHEN OTHERS THEN
    UPDATE public.community_events_cache
      SET last_refresh_status = 'kick_error',
          last_refresh_error  = SQLERRM,
          updated_at          = now()
      WHERE id = 1;
  END;
END;$$;

-- Kick immediately so the queue starts draining and events refresh without
-- waiting for the next cron tick.
SELECT public.kick_community_events_refresh();
