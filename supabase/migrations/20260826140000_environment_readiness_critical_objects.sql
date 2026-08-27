-- 2026-08-26 · environment_readiness(): assert critical DB OBJECTS exist.
--
-- WHY: this project has NO project-level migration tracking (there is no
-- supabase_migrations.schema_migrations table — verified in prod on 2026-08-26).
-- Migrations are hand-applied via the SQL editor, so a DB object a DEPLOYED edge
-- function depends on can silently be missing. That is exactly the Discord-linking
-- outage: discord-oauth-start called public.create_discord_oauth_state(...), which
-- had never been applied to prod, so every attempt returned PGRST202 and the UI
-- showed "Could not start Discord linking. Please try again."
--
-- Because there is no migration history to diff against, the right drift check
-- here is object EXISTENCE (the same shape as the extension / pgmq / cron checks
-- already in this function). config-preflight.yml already calls this RPC daily
-- and fails + pages Discord on any 'missing'/'error' row, so no workflow change
-- is needed — a missing critical object now goes red on its own.
--
-- HOW TO EXTEND: whenever a migration introduces a DB object that a shipped edge
-- function relies on, add a row to section 6 below. Signature-qualified function
-- checks (to_regprocedure) also flag an incompatible redefinition, not just a
-- total absence.
--
-- Reproduced verbatim from 20260822160000 (the current definition) with ONE new
-- section (6) appended before the final RETURN. Sections 1-5 are unchanged.

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

  -- 6) Critical DB objects that a DEPLOYED edge function depends on. No migration
  --    tracking exists here, so a hand-applied migration can be skipped and the
  --    object silently absent (the 2026-08-26 Discord-linking outage). Assert
  --    each such object EXISTS; add a row when a migration introduces a new one.
  BEGIN
    -- functions (signature-qualified: NULL if absent OR redefined incompatibly)
    FOR r IN SELECT unnest(ARRAY[
      'public.create_discord_oauth_state(uuid,text,text,integer)',
      'public.consume_discord_oauth_state(uuid,text)'
    ]) AS sig LOOP
      RETURN QUERY SELECT 'db_object'::text, r.sig,
        CASE WHEN to_regprocedure(r.sig) IS NOT NULL THEN 'ok' ELSE 'missing' END,
        NULL::text;
    END LOOP;
    -- tables / relations
    FOR r IN SELECT unnest(ARRAY[
      'public.discord_oauth_states'
    ]) AS rel LOOP
      RETURN QUERY SELECT 'db_object'::text, r.rel,
        CASE WHEN to_regclass(r.rel) IS NOT NULL THEN 'ok' ELSE 'missing' END,
        NULL::text;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT 'db_object'::text, '(check failed)'::text, 'error'::text, LEFT(SQLERRM, 300);
  END;

  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.environment_readiness() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.environment_readiness() TO authenticated, service_role;

COMMENT ON FUNCTION public.environment_readiness() IS
  'Admin-only P0 observability check: extensions, pgmq queues, vault secrets (incl. service_role JWT role), FULL critical-cron coverage with per-job staleness, any cron whose latest run failed, and critical DB objects that deployed edge functions depend on (section 6, 20260826140000 — Discord OAuth objects; extend as needed). Backs config-preflight.yml. See migrations 20260708030000 + 20260809120200 + 20260826140000.';
