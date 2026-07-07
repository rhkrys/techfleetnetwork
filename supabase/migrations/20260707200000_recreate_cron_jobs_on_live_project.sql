-- Recreate every background cron job on the live project from scratch.
--
-- Root cause discovered while chasing "email enqueued but never delivered":
-- `SELECT * FROM cron.job` returns "relation cron.job does not exist" on this
-- project — the pg_cron extension itself was never enabled here. Digging into
-- migration history (supabase/migrations/20260316051305_email_infra.sql)
-- explains why: these jobs were originally created via the Supabase
-- Management API by Lovable's tooling directly against the OLD project,
-- "each time the tool runs" — never as portable migration SQL. So no amount
-- of replaying migrations onto the new project could have recreated them;
-- PR #70 (20260707190000_repoint_cron_jobs_to_live_project.sql), which loops
-- over EXISTING cron.job rows to fix their host, is a correct but now-moot
-- no-op here, because there were no rows to begin with.
--
-- This migration is the first PORTABLE, replayable definition of these jobs.
-- It intentionally does NOT reuse the current_setting('app.settings.*')
-- auth pattern seen on two of the original jobs (app-confirmation-sweeper,
-- triage-digest-daily) — that Postgres GUC was very likely also never set on
-- this project (same class of gap as pg_cron itself), so instead every job
-- uses the same Vault-secret COALESCE lookup already proven reliable in this
-- codebase (prewarm-ugc-worker, replay-email-dlq, edge-deploy-smoke,
-- auth-prober).
--
-- Not recreated: 'triage-critical-push'. No migration ever contains its
-- original cron.schedule(...) call (only a later cron.alter_job against an
-- assumed-existing job) — its schedule cannot be verified from history, and
-- inventing one would violate "don't guess." Flag separately if wanted.
--
-- PREREQUISITE: run this in the Supabase SQL Editor AS ITS OWN QUERY FIRST,
-- confirm it succeeds, before running the job-creation script below:
--
--   CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA cron;
--
-- (If that errors with a permission message, enable pg_cron via the
-- Dashboard instead: Database -> Extensions -> search "pg_cron" -> Enable.)

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
  -- ---- process-email-queue — every 5 seconds -----------------------------
  -- The direct cause of the missing confirmation email: drains
  -- pgmq.q_auth_emails / q_transactional_emails / q_bulk_emails and calls
  -- the email provider. Skips the call when nothing is queued or a rate
  -- -limit cooldown is active.
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'process-email-queue';
  PERFORM cron.schedule(
    'process-email-queue',
    '5 seconds',
    format($cmd$
      SELECT CASE
        WHEN (SELECT retry_after_until FROM public.email_send_state WHERE id = 1) > now()
          THEN NULL
        WHEN EXISTS (SELECT 1 FROM pgmq.q_auth_emails LIMIT 1)
          OR EXISTS (SELECT 1 FROM pgmq.q_transactional_emails LIMIT 1)
          OR EXISTS (SELECT 1 FROM pgmq.q_bulk_emails LIMIT 1)
          THEN net.http_post(
            url := %L,
            headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', %s),
            body := '{}'::jsonb
          )
        ELSE NULL
      END;
    $cmd$, v_url || '/functions/v1/process-email-queue', v_auth)
  );

  -- ---- app-confirmation-sweeper — every 5 minutes ------------------------
  -- Safety net for application-confirmation emails (catches any row the
  -- immediate client-triggered call missed or that failed transiently).
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'app-confirmation-sweeper';
  PERFORM cron.schedule(
    'app-confirmation-sweeper',
    '*/5 * * * *',
    format($cmd$
      SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', %s),
        body := jsonb_build_object('source', 'cron', 'scheduled_at', now())
      ) AS request_id;
    $cmd$, v_url || '/functions/v1/send-application-confirmation', v_auth)
  );

  -- ---- replay-email-dlq — every 5 minutes --------------------------------
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'replay-email-dlq-every-5min';
  PERFORM cron.schedule(
    'replay-email-dlq-every-5min',
    '*/5 * * * *',
    format($cmd$
      SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', %s),
        body := jsonb_build_object('source', 'cron', 'at', now()::text)
      );
    $cmd$, v_url || '/functions/v1/replay-email-dlq', v_auth)
  );

  -- ---- triage-digest-daily — 15:00 UTC daily -----------------------------
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'triage-digest-daily';
  PERFORM cron.schedule(
    'triage-digest-daily',
    '0 15 * * *',
    format($cmd$
      SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', %s),
        body := jsonb_build_object('source', 'cron', 'scheduled_at', now())
      );
    $cmd$, v_url || '/functions/v1/triage-digest-builder', v_auth)
  );

  -- ---- email-pipeline-health — every 15 minutes --------------------------
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'email-pipeline-health-every-15m';
  PERFORM cron.schedule(
    'email-pipeline-health-every-15m',
    '*/15 * * * *',
    format($cmd$
      SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', %s),
        body := '{}'::jsonb
      );
    $cmd$, v_url || '/functions/v1/email-pipeline-health', v_auth)
  );

  -- ---- refresh-community-events — every 10 minutes -----------------------
  -- Calls public.kick_community_events_refresh(), whose body already points
  -- at the live project (fixed in PR #70) — this just (re)creates the job.
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'refresh-community-events';
  PERFORM cron.schedule(
    'refresh-community-events',
    '*/10 * * * *',
    $cmd$ SELECT public.kick_community_events_refresh(); $cmd$
  );

  -- ---- prewarm-ugc-worker — every 30 seconds -----------------------------
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname IN ('prewarm-ugc-worker-30s', 'prewarm-ugc-worker-every-30s');
  PERFORM cron.schedule(
    'prewarm-ugc-worker-every-30s',
    '30 seconds',
    format($cmd$
      SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', %s),
        body := jsonb_build_object('source', 'cron')
      );
    $cmd$, v_url || '/functions/v1/prewarm-ugc-worker', v_auth)
  );

  -- ---- process-freescout-events — every 15 seconds -----------------------
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname IN ('process-freescout-events-15s', 'process-freescout-events-every-15s');
  PERFORM cron.schedule(
    'process-freescout-events-every-15s',
    '15 seconds',
    format($cmd$
      SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', %s),
        body := jsonb_build_object('source', 'cron'),
        timeout_milliseconds := 25000
      );
    $cmd$, v_url || '/functions/v1/process-freescout-events', v_auth)
  );

  -- ---- edge-deploy-smoke — every 10 minutes ------------------------------
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'edge-deploy-smoke-10min';
  PERFORM cron.schedule(
    'edge-deploy-smoke-10min',
    '*/10 * * * *',
    format($cmd$
      SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', %s),
        body := '{}'::jsonb,
        timeout_milliseconds := 30000
      );
    $cmd$, v_url || '/functions/v1/edge-deploy-smoke', v_auth)
  );

  -- ---- auth-prober — every 5 minutes -------------------------------------
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'auth-prober-5min';
  PERFORM cron.schedule(
    'auth-prober-5min',
    '*/5 * * * *',
    format($cmd$
      SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object('content-type', 'application/json', 'authorization', %s),
        body := '{}'::jsonb,
        timeout_milliseconds := 60000
      );
    $cmd$, v_url || '/functions/v1/auth-prober', v_auth)
  );
END $$;
