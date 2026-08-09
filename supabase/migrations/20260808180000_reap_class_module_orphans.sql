-- ============================================================================
-- Class Curriculum — orphaned-file reclamation (compliance-data-lifecycle DL-02).
--
-- Deleting a module/section/class cascade-removes class_module_attachments ROWS
-- but not the stored blobs in the private `class-module-files` bucket (SQL can't
-- delete storage objects). This ships:
--   1. list_class_module_file_orphans(interval) — a read-only SQL diff returning
--      bucket objects with NO attachment row, older than a grace window.
--   2. A pg_cron job that pokes the `reap-class-module-orphans` edge function
--      (which does the actual Storage-API deletion), following the repo's
--      net.http_post + Vault pattern (20260707200000_recreate_cron_jobs...).
--
-- Deletion safety: this migration deletes NOTHING. The SQL fn only SELECTs; the
-- edge function is DRY-RUN by default (deletes only when CURRICULUM_ORPHAN_REAP_
-- APPLY='true'), enforces a 48h grace window, and refuses any key outside the
-- class/{id}/item/{id}/… shape. So enabling actual reclamation is a deliberate,
-- reversible env flip — never a surprise.
--
-- pg_cron / pg_net may be absent on a fresh/local DB (CI migration-smoke); guard
-- so the migration still applies cleanly there (the schedule is simply skipped).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Orphan diff (read-only). Owner (postgres) can read storage.objects; only
--    service_role may execute it (the edge function calls it service-side).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_class_module_file_orphans(_older_than interval DEFAULT '48 hours')
RETURNS TABLE(name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT o.name
  FROM storage.objects o
  WHERE o.bucket_id = 'class-module-files'
    AND o.created_at < now() - _older_than
    AND NOT EXISTS (
      SELECT 1 FROM public.class_module_attachments a WHERE a.storage_path = o.name
    );
$$;
REVOKE ALL ON FUNCTION public.list_class_module_file_orphans(interval) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_class_module_file_orphans(interval) TO service_role;

-- ----------------------------------------------------------------------------
-- 2. Schedule the reaper edge function daily (03:40 UTC). The Vault lookup runs
--    at job-run time (it lives inside the stored command string), so this
--    applies even where Vault/pg_net are absent — hence the extension guards.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_url  text := 'https://pzvqxdgoztbfikfuifix.supabase.co';
  v_auth text := $auth$'Bearer ' || COALESCE(
      (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key' LIMIT 1),
      (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1),
      (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SERVICE_ROLE_KEY' LIMIT 1)
    )$auth$;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not installed; skipping orphan-reaper schedule'; RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RAISE NOTICE 'pg_net not installed; skipping orphan-reaper schedule'; RETURN;
  END IF;

  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'reap-class-module-orphans';
  PERFORM cron.schedule(
    'reap-class-module-orphans',
    '40 3 * * *',
    format($cmd$
      SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', %s),
        body := jsonb_build_object('source', 'cron'),
        timeout_milliseconds := 60000
      );
    $cmd$, v_url || '/functions/v1/reap-class-module-orphans', v_auth)
  );
END $$;
