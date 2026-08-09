-- Audit T-F: the Discord support path (_shared/support-ticket.ts) enforced the
-- per-member support cap with a read-then-upsert on support_rate_limits
-- (SELECT count → UPSERT count+1). That is a TOCTOU / last-writer-wins race:
-- two concurrent /support taps both read count=N and both write N+1, so the
-- 10/hr cap is bypassed. The web path already uses an ATOMIC increment
-- (support_check_rate_limit, caller-scoped via auth.uid()). This adds the same
-- atomic increment for a service-role caller that supplies the subject user_id
-- (the Discord worker has no auth.uid()).
CREATE OR REPLACE FUNCTION public.support_check_rate_limit_for(
  _subject_user_id uuid,
  _action text,
  _max_per_hour integer
) RETURNS boolean  -- true = allowed, false = over the cap
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _window timestamptz := date_trunc('hour', now());
  _count integer;
BEGIN
  IF _subject_user_id IS NULL THEN
    RAISE EXCEPTION 'subject_user_id required' USING ERRCODE = '22004';
  END IF;

  -- Atomic increment-and-return: the single UPSERT is race-free (no separate
  -- read), so concurrent calls serialize on the PK row and each sees a distinct
  -- count.
  INSERT INTO public.support_rate_limits(subject_user_id, action, window_start, count)
  VALUES (_subject_user_id, _action, _window, 1)
  ON CONFLICT (subject_user_id, action, window_start)
  DO UPDATE SET count = public.support_rate_limits.count + 1
  RETURNING count INTO _count;

  -- Opportunistic cleanup of stale windows (parity with support_check_rate_limit).
  DELETE FROM public.support_rate_limits
  WHERE window_start < now() - interval '24 hours';

  RETURN _count <= _max_per_hour;
END;
$$;

REVOKE ALL ON FUNCTION public.support_check_rate_limit_for(uuid, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.support_check_rate_limit_for(uuid, text, integer)
  TO service_role;
