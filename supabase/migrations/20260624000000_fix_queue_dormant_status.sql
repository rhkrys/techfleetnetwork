-- Fix-queue "dormant" status — stop age-based closure from masquerading as a fix.
--
-- Audit finding (epic 01): auto_resolve_stale_fix_queue() marked stale rows
-- status='resolved' purely by age (30d error / 7d warn). Combined with the
-- error-reporter SUPPRESSED_PATTERNS list, a bug that was merely *silenced*
-- would auto-"resolve" itself a month later — so `resolved` could not be
-- trusted to mean "fixed".
--
-- From now on:
--   * age-based closure  -> status='dormant'  ("aged out, no recurrence; NOT a
--     verified fix"). resolved_at stays NULL.
--   * 'resolved'         -> reserved for a fix that is verified and locked by a
--     regression test, set by the triage apply path or a human — never by the
--     mere passage of time.
--
-- NOTE: must be applied via the migration pipeline / Cowork (no live-DB access
-- from the code session). If the live status CHECK constraint is not named
-- `agent_fix_queue_status_check`, adjust the DROP below to the actual name
-- (\d+ public.agent_fix_queue) before applying.

-- 1. Allow the new terminal status alongside the existing six.
ALTER TABLE public.agent_fix_queue
  DROP CONSTRAINT IF EXISTS agent_fix_queue_status_check;
ALTER TABLE public.agent_fix_queue
  ADD CONSTRAINT agent_fix_queue_status_check
  CHECK (status IN ('pending','triaged','proposed','applied','dismissed','resolved','dormant'));

-- 2. Age-based sweeper now parks stale rows as 'dormant', not 'resolved'.
--    Same selection criteria as before; only the terminal status + reason and
--    the (now omitted) resolved_at change. Signature is unchanged so the
--    nightly cron (auto-resolve-fix-queue-nightly) keeps working as-is.
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
       SET status = 'dormant',
           updated_at = now(),
           dismissed_reason = COALESCE(dismissed_reason,
             CASE
               WHEN severity = 'error'
                 THEN 'auto-dormant: no recurrence in 30 days (NOT a verified fix)'
               ELSE 'auto-dormant: no recurrence in 7 days (NOT a verified fix)'
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

COMMENT ON FUNCTION public.auto_resolve_stale_fix_queue() IS
  'Parks stale fix-queue rows as status=dormant (aged out, NOT a verified fix). '
  '"resolved" is reserved for fixes proven by a linked regression test.';
