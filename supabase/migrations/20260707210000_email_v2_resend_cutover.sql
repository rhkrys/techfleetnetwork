-- Email cutover to Resend via the v2 pipeline.
--
-- State before this migration (verified live on the project):
--   * email_outbox table + invoke_email_dispatcher_cron() exist
--   * NO 'email-dispatcher-v2' cron job (never created here — same cutover gap
--     as every other cron; see 20260707200000_recreate_cron_jobs_on_live_project)
--   * email_send_state.pipeline_v2_lanes_bitmask = 4 (bulk only). auth (1) and
--     transactional (2) still route to the LEGACY pipeline (process-email-queue
--     -> Lovable), which is why application-confirmation / auth emails never
--     sent: process-email-queue requires LOVABLE_API_KEY (unset) and returns
--     "Server configuration error", while the operator has configured
--     EMAIL_PROVIDER=resend + RESEND_API_KEY on the v2 path instead.
--
-- This migration:
--   1. Creates the v2 dispatcher cron ('email-dispatcher-v2', every 30s) that
--      drains public.email_outbox by POSTing to /functions/v1/email-dispatcher.
--      Self-contained net.http_post using the live project URL + the
--      email_queue_service_role_key vault secret (same robust COALESCE pattern
--      as the recreated legacy jobs) rather than depending on
--      invoke_email_dispatcher_cron()'s internal vault-key name.
--   2. Flips pipeline_v2_lanes_bitmask to 7 (auth|transactional|bulk) so ALL
--      lanes route through the v2 Outbox -> email-dispatcher -> Resend.
--
-- After this, new sends go via Resend. The recreated 'app-confirmation-sweeper'
-- (every 5 min) reprocesses the already-stuck application_confirmation_outbox
-- rows through the same v2/Resend path automatically.
--
-- Requires pg_cron + pg_net enabled and the email_queue_service_role_key vault
-- secret set (all done in prior steps).

DO $$
DECLARE
  v_auth text := $auth$'Bearer ' || COALESCE(
      (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key' LIMIT 1),
      (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_service_role_key' LIMIT 1),
      (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1),
      (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SERVICE_ROLE_KEY' LIMIT 1)
    )$auth$;
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'email-dispatcher-v2';
  PERFORM cron.schedule(
    'email-dispatcher-v2',
    '30 seconds',
    format($cmd$
      SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', %s),
        body := jsonb_build_object('source', 'cron', 'at', now()::text),
        timeout_milliseconds := 30000
      );
    $cmd$, 'https://pzvqxdgoztbfikfuifix.supabase.co/functions/v1/email-dispatcher', v_auth)
  );
END $$;

-- Route all lanes (auth=1 | transactional=2 | bulk=4) through v2 -> Resend.
UPDATE public.email_send_state SET pipeline_v2_lanes_bitmask = 7 WHERE id = 1;
