-- Skills-audit finding (03 DB/RLS): the Lovable-era support SECURITY DEFINER
-- functions pin `SET search_path = public` instead of the hardened empty ``''``
-- standard the rest of the codebase uses. This CREATE OR REPLACE hardens them to
-- `search_path = ''` with fully-qualified names. Bodies are otherwise identical
-- to the originals (20260601175315 / 20260601180027); the only changes are:
--   * search_path = ''  (public objects were already public.-qualified)
--   * 'admin'::app_role -> 'admin'::public.app_role  (type needs qualification)
--   * add `#variable_conflict use_column` to the two RETURNS TABLE plpgsql fns
--     (required by the check-plpgsql-variable-conflict CI gate on re-definition)
--   * support_block_mutations gains a pinned search_path (had none)
-- The freescout_* queue RPCs already use an explicitly-scoped `public, pgmq`
-- (not the mutable default) and are left as-is.

-- ── support_check_rate_limit ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.support_check_rate_limit(_action text, _max_per_hour integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _uid uuid := auth.uid();
  _window timestamptz := date_trunc('hour', now());
  _count integer;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '28000';
  END IF;

  INSERT INTO public.support_rate_limits(subject_user_id, action, window_start, count)
  VALUES (_uid, _action, _window, 1)
  ON CONFLICT (subject_user_id, action, window_start)
  DO UPDATE SET count = public.support_rate_limits.count + 1
  RETURNING count INTO _count;

  IF _count > _max_per_hour THEN
    RAISE EXCEPTION 'rate_limit_exceeded' USING ERRCODE = 'P0001';
  END IF;

  DELETE FROM public.support_rate_limits
  WHERE window_start < now() - interval '24 hours';
END;
$$;
REVOKE ALL ON FUNCTION public.support_check_rate_limit(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.support_check_rate_limit(text, integer) TO authenticated, service_role;

-- ── support_backfill_provisioning (admin-only) ─────────────────────────────
CREATE OR REPLACE FUNCTION public.support_backfill_provisioning(_mode text)
RETURNS TABLE (queued integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  _n integer := 0;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF _mode = 'admins' THEN
    INSERT INTO public.support_provisioning_log(user_id, kind, status, attempts, last_error)
    SELECT ur.user_id, 'admin_user', 'retry', 0, 'queued via backfill'
    FROM public.user_roles ur
    LEFT JOIN public.profiles p ON p.id = ur.user_id
    WHERE ur.role = 'admin'::public.app_role
      AND (p.freescout_user_id IS NULL);
    GET DIAGNOSTICS _n = ROW_COUNT;
  ELSIF _mode = 'members' THEN
    INSERT INTO public.support_provisioning_log(user_id, kind, status, attempts, last_error)
    SELECT p.id, 'customer', 'retry', 0, 'queued via backfill'
    FROM public.profiles p
    WHERE p.freescout_customer_id IS NULL;
    GET DIAGNOSTICS _n = ROW_COUNT;
  ELSE
    RAISE EXCEPTION 'invalid_mode' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY SELECT _n;
END;
$$;
REVOKE ALL ON FUNCTION public.support_backfill_provisioning(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.support_backfill_provisioning(text) TO authenticated, service_role;

-- ── get_support_monthly_report (admin-only) ────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_support_monthly_report(_from date DEFAULT (now() - interval '12 months')::date)
RETURNS TABLE(month date, status text, ticket_count bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT m.month, m.status, m.ticket_count
    FROM public.support_categories_monthly_mv m
    WHERE m.month >= _from
    ORDER BY m.month DESC, m.status;
END;
$$;
REVOKE ALL ON FUNCTION public.get_support_monthly_report(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_support_monthly_report(date) TO authenticated, service_role;

-- ── refresh_support_monthly_report (service-role) ──────────────────────────
CREATE OR REPLACE FUNCTION public.refresh_support_monthly_report()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.support_categories_monthly_mv;
EXCEPTION WHEN OTHERS THEN
  REFRESH MATERIALIZED VIEW public.support_categories_monthly_mv;
END;
$$;
REVOKE ALL ON FUNCTION public.refresh_support_monthly_report() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_support_monthly_report() TO service_role;

-- ── support_block_mutations (append-only trigger; add pinned search_path) ───
CREATE OR REPLACE FUNCTION public.support_block_mutations()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'support % is append-only', TG_TABLE_NAME USING ERRCODE = '42501';
END;
$$;

-- ── support_pending_provisioning (service-role; LANGUAGE sql) ───────────────
CREATE OR REPLACE FUNCTION public.support_pending_provisioning(_limit int DEFAULT 25)
RETURNS TABLE(user_id uuid, kind text, attempts int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH latest AS (
    SELECT DISTINCT ON (user_id, kind)
      user_id, kind, status, attempts
    FROM public.support_provisioning_log
    ORDER BY user_id, kind, created_at DESC
  )
  SELECT user_id, kind, attempts
  FROM latest
  WHERE status = 'retry' AND attempts < 5
  LIMIT GREATEST(_limit, 1);
$$;
REVOKE ALL ON FUNCTION public.support_pending_provisioning(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.support_pending_provisioning(int) TO service_role;

-- ── support_prune_webhook_events (service-role) ────────────────────────────
CREATE OR REPLACE FUNCTION public.support_prune_webhook_events()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE n int;
BEGIN
  ALTER TABLE public.support_webhook_events DISABLE TRIGGER trg_support_webhook_events_no_update;
  DELETE FROM public.support_webhook_events WHERE received_at < now() - interval '7 days';
  GET DIAGNOSTICS n = ROW_COUNT;
  ALTER TABLE public.support_webhook_events ENABLE TRIGGER trg_support_webhook_events_no_update;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.support_prune_webhook_events() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.support_prune_webhook_events() TO service_role;
