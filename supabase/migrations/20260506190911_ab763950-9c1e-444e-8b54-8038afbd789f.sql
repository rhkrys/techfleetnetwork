DO $$
DECLARE
  v_key text;
  v_url text := 'https://iqsjhrhsjlgjiaedzmtz.supabase.co/functions/v1';
BEGIN
  SELECT decrypted_secret INTO v_key
  FROM vault.decrypted_secrets
  WHERE name = 'email_queue_service_role_key'
  LIMIT 1;

  -- REPAIR (audit H3/H4, 2026-08-08): was `RAISE EXCEPTION` which aborted a fresh
  -- `supabase db reset` (empty Vault) — one of the reasons the DB was not
  -- rebuildable from source. This is an obsolete one-time cron rewire (note the
  -- OLD project URL below); on any env without the secret it must skip, not fail.
  IF v_key IS NULL THEN
    RAISE NOTICE 'vault secret email_queue_service_role_key not present; skipping cron rewire (expected on fresh/CI/new-project env)';
    RETURN;
  END IF;

  PERFORM cron.alter_job(
    job_id := (SELECT jobid FROM cron.job WHERE jobname = 'triage-digest-daily'),
    command := format($cmd$
      SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer %s'),
        body := jsonb_build_object('source','cron','scheduled_at',now())
      );
    $cmd$, v_url || '/triage-digest-builder', v_key)
  );

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'triage-critical-push') THEN
    PERFORM cron.alter_job(
      job_id := (SELECT jobid FROM cron.job WHERE jobname = 'triage-critical-push'),
      command := format($cmd$
        SELECT net.http_post(
          url := %L,
          headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer %s'),
          body := jsonb_build_object('source','cron','scheduled_at',now())
        );
      $cmd$, v_url || '/notify-critical-fix', v_key)
    );
  END IF;
END $$;