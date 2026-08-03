-- Nightly membership drift sweep + invariant tripwire.
--
-- reproject_membership_drift() re-derives every profile from the ledger (self-
-- heals any missed webhook/rebuild) and audits any paid profile with no backing
-- active sale (tamper/bug tripwire). Scheduled DIRECTLY as SQL (it's a DB
-- function, not an edge function) so there is no HTTP hop or auth surface.
--
-- Portable/replayable: unschedule-if-exists then schedule. Requires pg_cron
-- (already installed on this project per 20260707200000_recreate_cron_jobs...).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not installed; skipping membership-reproject-drift schedule';
    RETURN;
  END IF;

  PERFORM cron.unschedule(jobid)
    FROM cron.job
   WHERE jobname = 'membership-reproject-drift';

  PERFORM cron.schedule(
    'membership-reproject-drift',
    '17 8 * * *',                          -- 08:17 UTC daily, off-peak
    $cmd$ SELECT public.reproject_membership_drift(); $cmd$
  );
END
$$;
