-- One-shot close-out of stale freescout-proxy fingerprints.
UPDATE public.agent_fix_queue
   SET status = 'resolved',
       resolved_at = now(),
       updated_at = now(),
       dismissed_reason = COALESCE(dismissed_reason, 'auto-resolved: no recurrence since eager-provisioning shipped 2026-06-02')
 WHERE status IN ('pending', 'triaged', 'proposed')
   AND event_type = 'edge_invoke_failed'
   AND source ILIKE '%freescout-proxy%'
   AND last_seen_at < now() - interval '3 days';

-- Generic stale-row sweeper. Admin/service_role only.
CREATE OR REPLACE FUNCTION public.auto_resolve_stale_fix_queue()
RETURNS TABLE(resolved_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_count integer := 0;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR auth.role() = 'service_role') THEN
    RAISE EXCEPTION 'auto_resolve_stale_fix_queue: admin/service_role only';
  END IF;

  WITH closed AS (
    UPDATE public.agent_fix_queue
       SET status = 'resolved',
           resolved_at = now(),
           updated_at = now(),
           dismissed_reason = COALESCE(dismissed_reason,
             CASE
               WHEN severity = 'error'
                 THEN 'auto-resolved: no recurrence in 30 days'
               ELSE 'auto-resolved: no recurrence in 7 days'
             END)
     WHERE status IN ('pending', 'triaged', 'proposed')
       AND (snoozed_until IS NULL OR snoozed_until < now())
       AND (
         (severity = 'error' AND last_seen_at < now() - interval '30 days')
         OR (severity IN ('warn', 'info') AND last_seen_at < now() - interval '7 days')
       )
    RETURNING 1
  )
  SELECT count(*)::int INTO v_count FROM closed;

  RETURN QUERY SELECT v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.auto_resolve_stale_fix_queue() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auto_resolve_stale_fix_queue() TO service_role;

-- Nightly cron at 04:15 UTC.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auto-resolve-fix-queue-nightly') THEN
    PERFORM cron.unschedule('auto-resolve-fix-queue-nightly');
  END IF;

  PERFORM cron.schedule(
    'auto-resolve-fix-queue-nightly',
    '15 4 * * *',
    $cron$ SELECT public.auto_resolve_stale_fix_queue(); $cron$
  );
END;
$$;