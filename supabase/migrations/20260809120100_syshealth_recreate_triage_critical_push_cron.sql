-- Wave 0 · P0-2 — Recreate the `triage-critical-push` cron that drives the
-- critical-alert push path (lost at cutover; live `cron.job` has no such row).
--
-- Why this is the linchpin: `notify-critical-fix` scans `agent_fix_queue` for
-- severity='error' fingerprints and fans a web-push to admins. It is invoked
-- ONLY by this cron. With the cron gone, EVERY critical alert is silent —
-- including the (now correctly-written) edge-deploy-smoke "function not deployed"
-- events and reconciler DLQ escalations. Nothing pages anyone.
--
-- The canonical registry 20260707200000 explicitly declined to recreate this job
-- because its original schedule "cannot be verified from history." The 5-minute
-- cadence used here is the one documented in the probe design (auth-prober header
-- "emits a Triage Critical Push … every 5 minutes"; edge-deploy-smoke's original
-- comment referenced "the existing Triage Critical Push (5-min cron)") and is
-- bounded downstream by notify-critical-fix's own HOURLY_CAP=3, so it cannot
-- over-page. Tune the cadence here if desired.
--
-- Auth + host pattern is identical to the sibling service-role cron jobs in
-- 20260707200000 (Vault-secret bearer; notify-critical-fix is service-role gated
-- via the shared constant-time authorizeServiceRoleRequest).

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
    RAISE NOTICE 'pg_cron not installed; skipping triage-critical-push schedule';
    RETURN;
  END IF;

  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'triage-critical-push';

  PERFORM cron.schedule(
    'triage-critical-push',
    '*/5 * * * *',
    format($cmd$
      SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', %s),
        body := jsonb_build_object('source', 'cron', 'scheduled_at', now())
      );
    $cmd$, v_url || '/functions/v1/notify-critical-fix', v_auth)
  );
END
$$;
