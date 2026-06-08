-- 1. auto-resolve helper -----------------------------------------------------
CREATE OR REPLACE FUNCTION public.auto_resolve_stale_fix_queue()
RETURNS TABLE(resolved_count INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_count INTEGER := 0;
BEGIN
  WITH updated AS (
    UPDATE public.agent_fix_queue
       SET status = 'resolved',
           resolved_at = now(),
           updated_at = now()
     WHERE status IN ('pending','triaged','proposed')
       AND (
         (severity = 'error' AND last_seen_at < now() - interval '30 days')
         OR (severity = 'warn'  AND last_seen_at < now() - interval '7 days')
         OR (severity = 'info'  AND last_seen_at < now() - interval '3 days')
       )
     RETURNING 1
  )
  SELECT COUNT(*) INTO v_count FROM updated;

  RETURN QUERY SELECT v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.auto_resolve_stale_fix_queue() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auto_resolve_stale_fix_queue() TO service_role;

-- 2. one-shot sweep right now -------------------------------------------------
SELECT public.auto_resolve_stale_fix_queue();

UPDATE public.agent_fix_queue
   SET status = 'resolved',
       resolved_at = now(),
       updated_at = now(),
       dismissed_reason = 'auto-resolved: no recurrence since eager-provisioning shipped 2026-06-02'
 WHERE status IN ('pending','triaged','proposed')
   AND event_type = 'edge_invoke_failed'
   AND source ILIKE 'edge.freescout-proxy%'
   AND last_seen_at < now() - interval '3 days';

-- 3. nightly cron -------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auto-resolve-fix-queue-nightly') THEN
      PERFORM cron.unschedule('auto-resolve-fix-queue-nightly');
    END IF;
    PERFORM cron.schedule(
      'auto-resolve-fix-queue-nightly',
      '15 4 * * *',
      $job$ SELECT public.auto_resolve_stale_fix_queue(); $job$
    );
  END IF;
END $$;

-- 4. known-issue catalog seeds — substring rules cap at 30-day TTL ----------
INSERT INTO public.known_issue_catalog (pattern, match_kind, event_type_filter, reason, expires_at, is_active)
VALUES
  ('Failed to execute ''insertBefore'' on ''Node''',
   'substring', 'ui_render_error',
   'Translation-extension (Google Translate / Transover / DeepL) DOM-mutation race with React reconciler. Auto-recovered by ScopedErrorBoundary silent remount + classify.ts isDomExtensionMutationError.',
   now() + interval '30 days', true),
  ('Failed to execute ''removeChild'' on ''Node''',
   'substring', 'ui_render_error',
   'Same DOM-mutation-extension class as insertBefore. Auto-recovered by ScopedErrorBoundary.',
   now() + interval '30 days', true),
  ('transover-popup',
   'substring', NULL,
   'Transover translation browser extension DOM injection — not our code.',
   now() + interval '30 days', true),
  ('Failed to connect to MetaMask',
   'substring', NULL,
   'MetaMask browser extension probing every page for ethereum provider — not our app.',
   now() + interval '30 days', true)
ON CONFLICT DO NOTHING;