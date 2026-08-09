-- ============================================================================
-- Class Curriculum — audit retention (compliance-data-lifecycle DL-02).
--
-- class_module_audit is append-only and grows unbounded. Prune rows older than
-- 24 months on a daily pg_cron schedule, mirroring the repo's established
-- retention precedent (purge-cron-run-history 20260729180000, and
-- enforce_retention_policy 20260507035848 — same guarded schedule shape).
--
-- Deletion safety (owasp lockout/accidental-deletion check): this removes ONLY
-- audit metadata older than 24 months. It never touches access, credentials,
-- roles, or learner/teacher content — nothing here can lock anyone out, and it
-- is bounded to rows well past the retention window. No down-migration needed
-- (a schedule, plus already-expired rows).
--
-- pg_cron may be absent on a fresh/local DB (CI migration-smoke). Guard for it
-- so the migration still applies cleanly there (the schedule is simply skipped).
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not installed; skipping class_module_audit retention schedule';
    RETURN;
  END IF;

  -- Idempotent: drop any prior definition of this job before (re)scheduling.
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'purge-class-module-audit';

  PERFORM cron.schedule(
    'purge-class-module-audit',
    '25 3 * * *',  -- daily 03:25 UTC, off-peak and clear of other retention jobs
    $cmd$ DELETE FROM public.class_module_audit WHERE created_at < now() - interval '24 months' $cmd$
  );
END $$;

-- One-time catch-up so the policy takes effect immediately on deploy (harmless
-- if the table is younger than the window — deletes nothing).
DELETE FROM public.class_module_audit WHERE created_at < now() - interval '24 months';
