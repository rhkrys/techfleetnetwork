
-- Monthly report MV for admin Help Desk reports panel
CREATE MATERIALIZED VIEW IF NOT EXISTS public.support_categories_monthly_mv AS
SELECT
  date_trunc('month', created_at)::date AS month,
  COALESCE(last_status, 'unknown')      AS status,
  COUNT(*)::bigint                       AS ticket_count
FROM public.support_ticket_pointers
GROUP BY 1, 2;

CREATE UNIQUE INDEX IF NOT EXISTS support_categories_monthly_mv_uq
  ON public.support_categories_monthly_mv (month, status);

REVOKE ALL ON public.support_categories_monthly_mv FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.support_categories_monthly_mv TO service_role;

-- Admin-only read RPC (avoids exposing MV directly to Data API)
CREATE OR REPLACE FUNCTION public.get_support_monthly_report(_from date DEFAULT (now() - interval '12 months')::date)
RETURNS TABLE(month date, status text, ticket_count bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
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

CREATE OR REPLACE FUNCTION public.refresh_support_monthly_report()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.support_categories_monthly_mv;
EXCEPTION WHEN OTHERS THEN
  REFRESH MATERIALIZED VIEW public.support_categories_monthly_mv;
END;
$$;
REVOKE ALL ON FUNCTION public.refresh_support_monthly_report() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_support_monthly_report() TO service_role;

-- A08: append-only enforcement on audit-style tables
CREATE OR REPLACE FUNCTION public.support_block_mutations()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'support % is append-only', TG_TABLE_NAME USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS trg_support_prov_log_no_update ON public.support_provisioning_log;
CREATE TRIGGER trg_support_prov_log_no_update
  BEFORE UPDATE OR DELETE ON public.support_provisioning_log
  FOR EACH ROW EXECUTE FUNCTION public.support_block_mutations();

DROP TRIGGER IF EXISTS trg_support_ticket_events_no_update ON public.support_ticket_events;
CREATE TRIGGER trg_support_ticket_events_no_update
  BEFORE UPDATE OR DELETE ON public.support_ticket_events
  FOR EACH ROW EXECUTE FUNCTION public.support_block_mutations();

DROP TRIGGER IF EXISTS trg_support_webhook_events_no_update ON public.support_webhook_events;
CREATE TRIGGER trg_support_webhook_events_no_update
  BEFORE UPDATE OR DELETE ON public.support_webhook_events
  FOR EACH ROW EXECUTE FUNCTION public.support_block_mutations();

-- Helper for retry cron: pick next users needing provisioning retry
CREATE OR REPLACE FUNCTION public.support_pending_provisioning(_limit int DEFAULT 25)
RETURNS TABLE(user_id uuid, kind text, attempts int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
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

-- Webhook events 7-day prune helper
CREATE OR REPLACE FUNCTION public.support_prune_webhook_events()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int;
BEGIN
  -- Bypass append-only trigger by disabling for the session — only service_role can call this
  ALTER TABLE public.support_webhook_events DISABLE TRIGGER trg_support_webhook_events_no_update;
  DELETE FROM public.support_webhook_events WHERE received_at < now() - interval '7 days';
  GET DIAGNOSTICS n = ROW_COUNT;
  ALTER TABLE public.support_webhook_events ENABLE TRIGGER trg_support_webhook_events_no_update;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.support_prune_webhook_events() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.support_prune_webhook_events() TO service_role;
