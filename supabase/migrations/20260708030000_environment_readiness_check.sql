-- P0 observability — public.environment_readiness()
--
-- The 2026-07-07/08 cutover firefight took hours because broken infra failed
-- SILENTLY: pg_cron not enabled, pgmq queues missing, vault secrets absent or
-- holding the wrong key format, cron jobs never created. Nothing surfaced it.
--
-- This function inventories + verifies everything an environment needs, so a
-- broken/incomplete project shows a handful of red rows instead of requiring a
-- multi-hour spelunk. Admin-only. Surfaced on the System Health page (frontend
-- wiring is a follow-up). Every section is exception-guarded so one missing
-- piece (e.g. no pg_cron) degrades to a row, never crashes the whole check.
--
-- NOTE: edge-function secrets (RESEND_API_KEY, EMAIL_PROVIDER,
-- AUTH_EMAIL_HOOK_SECRET, TURNSTILE_SECRET_KEY, FREESCOUT_API_KEY, DISCORD_*)
-- live in the Deno edge runtime and cannot be read from SQL — a companion
-- `environment-readiness` edge function (Deno.env.get presence checks) is the
-- next piece and will merge into the same System Health surface.

CREATE OR REPLACE FUNCTION public.environment_readiness()
RETURNS TABLE(category text, item text, status text, detail text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  r record;
  v_role text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'admin role required' USING ERRCODE = '42501';
  END IF;

  -- 1) Required extensions
  FOR r IN SELECT unnest(ARRAY['pg_cron','pg_net','pgmq','supabase_vault']) AS ext LOOP
    RETURN QUERY SELECT 'extension'::text, r.ext,
      CASE WHEN EXISTS (SELECT 1 FROM pg_extension WHERE extname = r.ext) THEN 'ok' ELSE 'missing' END,
      NULL::text;
  END LOOP;

  -- 2) pgmq queues (v2 email lanes)
  BEGIN
    FOR r IN SELECT unnest(ARRAY['auth_emails','transactional_emails','bulk_emails']) AS q LOOP
      RETURN QUERY SELECT 'pgmq_queue'::text, r.q,
        CASE WHEN to_regclass('pgmq.q_' || r.q) IS NOT NULL THEN 'ok' ELSE 'missing' END,
        NULL::text;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT 'pgmq_queue'::text, '(check failed)'::text, 'error'::text, LEFT(SQLERRM, 300);
  END;

  -- 3) Vault secrets — present + decryptable, and the service-role key must be
  --    an actual service_role JWT (the exact gotcha that cost hours on 2026-07-08).
  BEGIN
    FOR r IN SELECT unnest(ARRAY['project_url','email_queue_service_role_key']) AS name LOOP
      RETURN QUERY
        SELECT 'vault_secret'::text, r.name,
          CASE WHEN EXISTS (
            SELECT 1 FROM vault.decrypted_secrets d
            WHERE d.name = r.name AND COALESCE(d.decrypted_secret,'') <> ''
          ) THEN 'ok' ELSE 'missing' END,
          NULL::text;
    END LOOP;

    SELECT CASE
      WHEN d.decrypted_secret LIKE 'eyJ%.%.%' THEN
        (convert_from(decode(
          translate(split_part(d.decrypted_secret,'.',2),'-_','+/') ||
          repeat('=', (4 - length(split_part(d.decrypted_secret,'.',2)) % 4) % 4), 'base64'
        ),'UTF8')::jsonb) ->> 'role'
      ELSE 'not_a_jwt'
    END
    INTO v_role
    FROM vault.decrypted_secrets d
    WHERE d.name = 'email_queue_service_role_key';

    RETURN QUERY SELECT 'vault_secret'::text, 'email_queue_service_role_key.role'::text,
      CASE WHEN v_role = 'service_role' THEN 'ok' ELSE 'error' END,
      'role=' || COALESCE(v_role, 'absent');
  EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT 'vault_secret'::text, '(check failed)'::text, 'error'::text, LEFT(SQLERRM, 300);
  END;

  -- 4) Critical cron jobs — present + active
  BEGIN
    FOR r IN SELECT unnest(ARRAY[
        'email-dispatcher-v2',
        'app-confirmation-sweeper',
        'auth-prober-5min',
        'process-freescout-events-every-15s',
        'refresh-community-events'
      ]) AS job LOOP
      RETURN QUERY SELECT 'cron_job'::text, r.job,
        CASE
          WHEN NOT EXISTS (SELECT 1 FROM cron.job j WHERE j.jobname = r.job) THEN 'missing'
          WHEN EXISTS (SELECT 1 FROM cron.job j WHERE j.jobname = r.job AND j.active) THEN 'ok'
          ELSE 'error'
        END,
        NULL::text;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT 'cron_job'::text, '(check failed — pg_cron missing?)'::text, 'error'::text, LEFT(SQLERRM, 300);
  END;

  -- 5) Any cron job whose MOST RECENT run failed — the loud signal that was
  --    missing all along (a job can exist + be active yet fail every tick).
  BEGIN
    FOR r IN
      SELECT j.jobname, d.return_message
      FROM cron.job j
      JOIN LATERAL (
        SELECT rd.status, rd.return_message
        FROM cron.job_run_details rd
        WHERE rd.jobid = j.jobid
        ORDER BY rd.start_time DESC
        LIMIT 1
      ) d ON TRUE
      WHERE d.status = 'failed'
    LOOP
      RETURN QUERY SELECT 'cron_run_failing'::text, r.jobname, 'error'::text, LEFT(r.return_message, 300);
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT 'cron_run_failing'::text, '(check failed)'::text, 'error'::text, LEFT(SQLERRM, 300);
  END;

  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.environment_readiness() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.environment_readiness() TO authenticated, service_role;

COMMENT ON FUNCTION public.environment_readiness() IS
  'Admin-only P0 observability check: verifies extensions, pgmq queues, vault secrets (incl. service_role JWT role), critical cron jobs, and surfaces any cron job whose latest run failed. Surfaced on System Health. See migration 20260708030000.';
