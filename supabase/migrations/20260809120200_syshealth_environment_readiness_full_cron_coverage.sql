-- Wave 0 · P1-1 — Widen environment_readiness() cron coverage + add staleness.
--
-- The check that exists specifically to catch "a cron silently died at cutover"
-- monitored only 5 of ~20 jobs (hardcoded list) and could not go red for the
-- reconciler, the pager, the self-healing engine, the watchdog, or retention —
-- i.e. exactly the jobs most likely to vanish. It also only flagged jobs whose
-- LAST run FAILED, so a job that was never scheduled (no run rows at all) was
-- invisible twice over. This is why the missing reconciler went unnoticed, and
-- why the daily config-preflight.yml gate (which runs this RPC) couldn't catch it.
--
-- This CREATE OR REPLACE keeps sections 1-3 and 5 intact and rewrites section 4
-- to assert every expected job is present + active, and — for high-frequency
-- jobs — that its latest run is recent. Low-frequency jobs (daily/weekly) carry
-- a NULL threshold: presence+active only, so they never false-alarm inside the
-- bounded 2-day run-history window.

CREATE OR REPLACE FUNCTION public.environment_readiness()
RETURNS TABLE(category text, item text, status text, detail text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
#variable_conflict use_column
DECLARE
  r record;
  v_role text;
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR COALESCE(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'service_role'
  ) THEN
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
  --    an actual service_role JWT.
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

  -- 4) Critical cron jobs — present + active, and (for high-frequency jobs)
  --    running recently. `max_stale_min` NULL => presence+active only (daily/
  --    weekly jobs: staleness can't be judged inside the 2-day run-history
  --    window, and purge-cron-run-history keeps only 7 days of details).
  BEGIN
    RETURN QUERY
    WITH expected(job, max_stale_min) AS (
      VALUES
        -- high-frequency: staleness enforced
        ('email-dispatcher-v2',                 10),
        ('prewarm-ugc-worker-every-30s',        10),
        ('process-freescout-events-every-15s',  10),
        ('self_healing_health_eval',            10),
        ('self_healing_remediations',           10),
        ('reconcile-stuck-emails',              20),
        ('auth-prober-5min',                    20),
        ('replay-email-dlq-every-5min',         20),
        ('app-confirmation-sweeper',            20),
        ('triage-critical-push',                20),
        ('refresh-community-events',            30),
        ('edge-deploy-smoke-10min',             30),
        ('email-pipeline-health-every-15m',     45),
        ('auth_email_watchdog_15m',             45),
        -- low-frequency: presence + active only
        ('triage-digest-daily',                 NULL::int),
        ('membership-reproject-drift',          NULL::int),
        ('gumroad-backfill-all-weekly',         NULL::int),
        ('enforce_retention_policy_daily',      NULL::int),
        ('purge-cron-run-history',              NULL::int),
        ('purge-class-module-audit',            NULL::int)
    ),
    latest_runs AS (
      SELECT DISTINCT ON (rd.jobid) rd.jobid, rd.status, rd.start_time
      FROM cron.job_run_details rd
      WHERE rd.start_time > now() - interval '2 days'
      ORDER BY rd.jobid, rd.start_time DESC
    )
    SELECT
      'cron_job'::text,
      e.job,
      CASE
        WHEN j.jobid IS NULL THEN 'missing'
        WHEN NOT j.active THEN 'error'
        WHEN e.max_stale_min IS NOT NULL
             AND (lr.start_time IS NULL OR lr.start_time < now() - make_interval(mins => e.max_stale_min))
          THEN 'error'
        ELSE 'ok'
      END,
      CASE
        WHEN j.jobid IS NULL THEN 'not scheduled'
        WHEN NOT j.active THEN 'inactive'
        WHEN e.max_stale_min IS NOT NULL AND lr.start_time IS NULL THEN 'no run in last 2 days'
        WHEN e.max_stale_min IS NOT NULL AND lr.start_time < now() - make_interval(mins => e.max_stale_min)
          THEN 'stale — last run ' || to_char(lr.start_time AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') || 'Z'
        ELSE NULL
      END
    FROM expected e
    LEFT JOIN cron.job j ON j.jobname = e.job
    LEFT JOIN latest_runs lr ON lr.jobid = j.jobid;
  EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT 'cron_job'::text, '(check failed — pg_cron missing?)'::text, 'error'::text, LEFT(SQLERRM, 300);
  END;

  -- 5) Any cron job whose MOST RECENT run failed (bounded 2-day pass).
  BEGIN
    FOR r IN
      SELECT j.jobname, d.return_message
      FROM (
        SELECT DISTINCT ON (rd.jobid) rd.jobid, rd.status, rd.return_message
        FROM cron.job_run_details rd
        WHERE rd.start_time > now() - interval '2 days'
        ORDER BY rd.jobid, rd.start_time DESC
      ) d
      JOIN cron.job j ON j.jobid = d.jobid
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
  'Admin-only P0 observability check: extensions, pgmq queues, vault secrets (incl. service_role JWT role), FULL critical-cron coverage with per-job staleness (Wave 0, 20260809120200), and any cron whose latest run failed. Backs config-preflight.yml. See migrations 20260708030000 + 20260809120200.';
