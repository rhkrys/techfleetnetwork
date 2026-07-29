-- Cron run-history retention.
--
-- pg_cron never prunes cron.job_run_details. Since 2026-07-08 the self-healing
-- crons run every 1-2 minutes (plus 15-30s email/freescout workers), so the
-- table grows by thousands of rows/day. Unbounded, it made the
-- environment_readiness() "latest run failed?" scan hit statement_timeout
-- (observed 2026-07-29). Standard pg_cron practice: schedule a daily purge.
-- 7 days retained — plenty for diagnosing "why did this job fail last week".

DO $$
BEGIN
  PERFORM cron.unschedule(jobname) FROM cron.job WHERE jobname = 'purge-cron-run-history';
EXCEPTION WHEN OTHERS THEN
  NULL; -- job does not exist yet
END $$;

SELECT cron.schedule(
  'purge-cron-run-history', '10 8 * * *',
  $cmd$ DELETE FROM cron.job_run_details WHERE end_time < now() - interval '7 days' $cmd$
);

-- One-time immediate prune so environment_readiness() is fast again today.
DELETE FROM cron.job_run_details WHERE end_time < now() - interval '7 days';
