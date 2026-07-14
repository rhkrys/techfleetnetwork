-- Restore the self-healing engine after the Supabase cutover.
--
-- Root cause: the health-evaluator and auto-remediation loop were scheduled via
-- cron.schedule() in a migration that ran on the OLD Lovable-era project. Like
-- every other pg_cron job, those schedules did not carry over to the owned
-- project (pzvqxdgoztbfikfuifix). Result: `system_health_state` froze (last
-- updated 2026-06-23) and `run_auto_remediations()` has never run here, so the
-- 7 enabled remediation rules sat idle. See mem: supabase-cutover-infra-gaps.
--
-- Also fixes one real allowlist gap: `cleanup_chunk_load_noise` (the resolver
-- for the "Auto-resolve ui_chunk_load_failed" rule) was never added to
-- is_remediation_allowed(), so that rule was permanently "blocked". The 2FA
-- rule's "blocked" status is merely STALE (its function is already allowlisted).
--
-- All referenced functions already exist on the project; this migration only
-- (1) widens the allowlist, (2) recreates the two cron jobs, (3) clears the
-- stale blocked statuses so the rules re-evaluate cleanly.

-- 1. Allowlist: add the ui-chunk-noise resolver (keep the rest identical).
CREATE OR REPLACE FUNCTION public.is_remediation_allowed(p_fn text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
  SELECT p_fn = ANY(ARRAY[
    'cleanup_stuck_email_queue',
    'cleanup_rate_limits',
    'cleanup_two_factor_login_artifacts',
    'drain_notification_outbox',
    'retry_stuck_fanout_jobs',
    'retry_pending_discord_role_grants',
    'cleanup_chunk_load_noise',
    'evaluate_system_health'
  ]);
$function$;

-- 2. Recreate the self-healing cron jobs (idempotent by jobname).
DO $$
BEGIN
  PERFORM cron.unschedule(jobname)
  FROM cron.job
  WHERE jobname IN ('self_healing_health_eval', 'self_healing_remediations');
EXCEPTION WHEN OTHERS THEN
  NULL; -- no such job yet
END $$;

SELECT cron.schedule(
  'self_healing_health_eval', '*/1 * * * *',
  $cmd$ SELECT public.evaluate_system_health(); $cmd$
);
SELECT cron.schedule(
  'self_healing_remediations', '*/2 * * * *',
  $cmd$ SELECT public.run_auto_remediations(); $cmd$
);

-- 3. Clear stale 'blocked' statuses so the next run re-evaluates from scratch.
UPDATE public.system_remediations
   SET last_status = NULL, last_error = NULL
 WHERE last_status = 'blocked';

-- 4. Unfreeze the health state immediately (don't wait for the first cron tick).
SELECT public.evaluate_system_health();
