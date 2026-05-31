-- ── Wave 2: Storage bucket size limits ──
UPDATE storage.buckets SET file_size_limit = 2  * 1024 * 1024 WHERE id = 'avatars'               AND file_size_limit IS NULL;
UPDATE storage.buckets SET file_size_limit = 5  * 1024 * 1024 WHERE id = 'class-hero-images'     AND file_size_limit IS NULL;
UPDATE storage.buckets SET file_size_limit = 5  * 1024 * 1024 WHERE id = 'client-logos'          AND file_size_limit IS NULL;
UPDATE storage.buckets SET file_size_limit = 200* 1024 * 1024 WHERE id = 'announcement-videos'   AND file_size_limit IS NULL;
UPDATE storage.buckets SET file_size_limit = 10 * 1024 * 1024 WHERE id = 'framework-source-csv'  AND file_size_limit IS NULL;
UPDATE storage.buckets SET file_size_limit = 10 * 1024 * 1024 WHERE id = 'policy-source-archive' AND file_size_limit IS NULL;

-- ── Cron cadence relaxation (idempotent: alter only if present) ──
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT jobid, jobname, schedule FROM cron.job
    WHERE jobname IN (
      'self-healing-health-eval','self_healing_health_eval',
      'self-healing-remediations','self_healing_remediations',
      'refresh-community-events',
      'prune-stale-rate-limits','prune_stale_rate_limits'
    )
  LOOP
    IF r.jobname IN ('self-healing-health-eval','self_healing_health_eval') AND r.schedule <> '*/5 * * * *' THEN
      PERFORM cron.alter_job(r.jobid, schedule => '*/5 * * * *');
    ELSIF r.jobname IN ('self-healing-remediations','self_healing_remediations') AND r.schedule <> '*/10 * * * *' THEN
      PERFORM cron.alter_job(r.jobid, schedule => '*/10 * * * *');
    ELSIF r.jobname = 'refresh-community-events' AND r.schedule <> '*/30 * * * *' THEN
      PERFORM cron.alter_job(r.jobid, schedule => '*/30 * * * *');
    ELSIF r.jobname IN ('prune-stale-rate-limits','prune_stale_rate_limits') AND r.schedule <> '*/30 * * * *' THEN
      PERFORM cron.alter_job(r.jobid, schedule => '*/30 * * * *');
    END IF;
  END LOOP;
END$$;

-- ── audit_log daily purge (uses existing purge_old_audit_logs(integer)) ──
DO $$
DECLARE existing_id bigint;
BEGIN
  SELECT jobid INTO existing_id FROM cron.job WHERE jobname = 'audit-log-daily-purge';
  IF existing_id IS NULL AND EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public' AND p.proname='purge_old_audit_logs'
  ) THEN
    PERFORM cron.schedule(
      'audit-log-daily-purge',
      '17 3 * * *',
      $cron$ SELECT public.purge_old_audit_logs(90); $cron$
    );
  END IF;
END$$;

-- ── web_vital_samples 7-day retention cron ──
DO $$
DECLARE existing_id bigint;
BEGIN
  SELECT jobid INTO existing_id FROM cron.job WHERE jobname = 'web-vitals-7d-purge';
  IF existing_id IS NULL AND to_regclass('public.web_vital_samples') IS NOT NULL THEN
    PERFORM cron.schedule(
      'web-vitals-7d-purge',
      '23 3 * * *',
      $cron$ DELETE FROM public.web_vital_samples WHERE created_at < now() - interval '7 days'; $cron$
    );
  END IF;
END$$;

-- ── Fleety query-embedding cache (24h TTL) ──
CREATE TABLE IF NOT EXISTS public.fleety_query_embedding_cache (
  text_hash text PRIMARY KEY,
  embedding jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fqec_created_at ON public.fleety_query_embedding_cache (created_at);

GRANT SELECT ON public.fleety_query_embedding_cache TO authenticated;
GRANT ALL    ON public.fleety_query_embedding_cache TO service_role;
ALTER TABLE public.fleety_query_embedding_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_full_fqec" ON public.fleety_query_embedding_cache;
CREATE POLICY "service_role_full_fqec"
  ON public.fleety_query_embedding_cache
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Purge entries older than 24h, scheduled daily
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname='fleety-qec-24h-purge') THEN
    PERFORM cron.schedule(
      'fleety-qec-24h-purge',
      '7 4 * * *',
      $cron$ DELETE FROM public.fleety_query_embedding_cache WHERE created_at < now() - interval '24 hours'; $cron$
    );
  END IF;
END$$;

-- ── fill-content-gaps daily counter (cap 500/day) ──
CREATE TABLE IF NOT EXISTS public.fill_content_gaps_counter (
  day date PRIMARY KEY DEFAULT (now() AT TIME ZONE 'UTC')::date,
  count integer NOT NULL DEFAULT 0
);
GRANT SELECT ON public.fill_content_gaps_counter TO authenticated;
GRANT ALL    ON public.fill_content_gaps_counter TO service_role;
ALTER TABLE public.fill_content_gaps_counter ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_full_fcgc" ON public.fill_content_gaps_counter;
CREATE POLICY "service_role_full_fcgc"
  ON public.fill_content_gaps_counter
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Helper: atomic increment + cap check; returns true if increment allowed.
CREATE OR REPLACE FUNCTION public.fill_content_gaps_check_and_inc(p_cap integer DEFAULT 500)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'UTC')::date;
  v_count integer;
BEGIN
  INSERT INTO public.fill_content_gaps_counter (day, count)
  VALUES (v_today, 1)
  ON CONFLICT (day) DO UPDATE SET count = public.fill_content_gaps_counter.count + 1
  RETURNING count INTO v_count;

  IF v_count > p_cap THEN
    -- Roll back the just-applied increment so the cap is exactly enforced.
    UPDATE public.fill_content_gaps_counter
       SET count = count - 1
     WHERE day = v_today;
    RETURN false;
  END IF;
  RETURN true;
END$$;

REVOKE ALL ON FUNCTION public.fill_content_gaps_check_and_inc(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fill_content_gaps_check_and_inc(integer) TO service_role;