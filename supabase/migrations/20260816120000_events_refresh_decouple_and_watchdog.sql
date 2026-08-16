-- Events calendar refresh: decouple the trigger credential from the rotating
-- service-role key, and add a staleness watchdog.
--
-- Context (docs/audits/events-calendar-audit-2026-08.md): the 2026-08 outage was
-- (1) the refresh cron missing after cutover, and (2) the cron→function auth
-- rejecting every current key because the function's injected SERVICE-ROLE key
-- was stale (pinned at deploy). The refresh went silently stale for 48 days
-- because nothing alerts on it. This migration addresses the recurrence risk:
--
--   * kick_community_events_refresh() now PREFERS a dedicated Vault secret
--     `events_refresh_secret` (paired with the function's EVENTS_REFRESH_SECRET
--     env), falling back to the service-role key so behaviour is unchanged until
--     the dedicated secret is provisioned (see docs/runbooks/events-refresh-secret.md).
--   * community_events_staleness_check() raises a standard audit_log event when
--     the cache hasn't refreshed in >30 min or is in an error state, so the
--     existing Silent Failures / triage surfaces catch it instead of it being
--     invisible. Scheduled every 15 min.
--
-- Idempotent and reset-safe (cron scheduling guarded on pg_cron availability).

-- ── 1. Decoupled kick ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.kick_community_events_refresh()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, extensions, pg_net
AS $$
DECLARE
  v_url    TEXT := 'https://pzvqxdgoztbfikfuifix.supabase.co';
  v_secret TEXT;
  v_err    TEXT;
BEGIN
  BEGIN
    -- Preferred: dedicated, rotation-stable trigger secret.
    SELECT decrypted_secret INTO v_secret
      FROM vault.decrypted_secrets WHERE name = 'events_refresh_secret' LIMIT 1;
    -- Fallbacks: the service-role key (legacy path, until the dedicated secret
    -- is provisioned). Same COALESCE order the other cron pokers use.
    IF v_secret IS NULL THEN
      SELECT decrypted_secret INTO v_secret
        FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key' LIMIT 1;
    END IF;
    IF v_secret IS NULL THEN
      SELECT decrypted_secret INTO v_secret
        FROM vault.decrypted_secrets WHERE name = 'supabase_service_role_key' LIMIT 1;
    END IF;
    IF v_secret IS NULL THEN
      SELECT decrypted_secret INTO v_secret
        FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
  END;

  IF v_secret IS NULL OR v_err IS NOT NULL THEN
    UPDATE public.community_events_cache
      SET last_refresh_status = 'config_error',
          last_refresh_error  = COALESCE(v_err,
            'no trigger secret in vault (events_refresh_secret or a service-role key)'),
          updated_at          = now()
      WHERE id = 1;
    RETURN;
  END IF;

  BEGIN
    PERFORM net.http_post(
      url     := v_url || '/functions/v1/refresh-community-events',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || v_secret
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

COMMENT ON FUNCTION public.kick_community_events_refresh IS
  'Calls /functions/v1/refresh-community-events via pg_net. Prefers the dedicated '
  'events_refresh_secret Vault secret; falls back to the service-role key. Used by cron.';

-- ── 2. Staleness watchdog ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.community_events_staleness_check()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_fetched TIMESTAMPTZ;
  v_status  TEXT;
  v_mins    NUMERIC;
BEGIN
  SELECT fetched_at, last_refresh_status
    INTO v_fetched, v_status
    FROM public.community_events_cache WHERE id = 1;

  v_mins := EXTRACT(epoch FROM (now() - COALESCE(v_fetched, 'epoch'::timestamptz))) / 60;

  IF v_fetched IS NULL
     OR v_mins > 30
     OR v_status IN ('error', 'config_error', 'kick_error') THEN
    -- Surfaces in get_top_silent_failures / the Silent Failures admin tab, which
    -- already match event_type = 'external_api_failed'.
    PERFORM public.try_write_audit_log(
      'external_api_failed',
      'community_events_cache',
      '1',
      NULL,
      NULL,
      format(
        'Community events calendar sync is stale: last successful refresh %s min ago (status=%s). Check the refresh cron, its trigger secret, and the edge function deploy.',
        COALESCE(round(v_mins)::text, 'never'),
        COALESCE(v_status, 'unknown')
      )
    );
  END IF;
END;$$;

COMMENT ON FUNCTION public.community_events_staleness_check IS
  'Watchdog: raises an external_api_failed audit event when the community events '
  'cache has not refreshed in >30 min or is in an error state. Scheduled every 15 min.';

-- ── 3. Schedule the watchdog (reset-safe) ────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    PERFORM cron.unschedule(jobid)
      FROM cron.job WHERE jobname = 'community-events-staleness-watchdog';
    PERFORM cron.schedule(
      'community-events-staleness-watchdog',
      '*/15 * * * *',
      $cron$ SELECT public.community_events_staleness_check(); $cron$
    );
  END IF;
END $$;
