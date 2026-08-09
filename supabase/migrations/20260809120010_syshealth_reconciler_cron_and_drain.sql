-- Wave 0 · P0-1 — Restore the stuck-email reconciler cron (lost at the Lovable
-- → owned-project cutover) and drain the accumulated backlog once.
--
-- Root cause: `cron.schedule('reconcile-stuck-emails', …)` existed only in the
-- pre-cutover migration 20260603134217, which ran against the OLD Lovable
-- project. The canonical post-cutover registry 20260707200000 recreated 10 jobs
-- but omitted this one, so on the owned project `pzvqxdgoztbfikfuifix` the job
-- never existed (live `SELECT count(*) FROM cron.job WHERE jobname =
-- 'reconcile-stuck-emails'` returns 0). Result: the System Health "Stuck pending"
-- card froze at its last pre-cutover run (2026-06-23) while 336 unique messages
-- (2360 raw rows) stayed `pending` with no self-healing.
--
-- reconcile_stuck_emails() is a DB function, idempotent, and safe on any cadence
-- (it dedupes by message_id and reconciles each stuck message against queue +
-- terminal reality). Scheduled DIRECTLY as SQL — no HTTP hop, no auth surface —
-- mirroring the membership-reproject-drift pattern (20260803120500).
--
-- Portable/replayable: pg_cron-guarded, unschedule-if-exists then schedule.

DO $$
DECLARE
  v_drain jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not installed; skipping reconcile-stuck-emails schedule';
    RETURN;
  END IF;

  PERFORM cron.unschedule(jobid)
    FROM cron.job
   WHERE jobname = 'reconcile-stuck-emails';

  PERFORM cron.schedule(
    'reconcile-stuck-emails',
    '*/5 * * * *',
    $cron$SELECT public.reconcile_stuck_emails();$cron$
  );

  -- One-time drain of the accumulated backlog so the fix is effective on apply,
  -- not only from the next tick. The result is the authoritative split of what
  -- the 336 stuck messages actually were: `reconciled_terminal` = already had a
  -- terminal (mostly already-sent, just mislogged); `requeued` = genuinely lost,
  -- re-enqueued so they now send; `dlq_lost` = unrecoverable (past TTL / no
  -- payload); `left_in_queue` = still being worked by the dispatcher.
  v_drain := public.reconcile_stuck_emails();
  RAISE NOTICE 'reconcile-stuck-emails initial drain: %', v_drain;
END
$$;
