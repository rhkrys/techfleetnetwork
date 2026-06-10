
CREATE OR REPLACE FUNCTION public.expire_stale_pending_v2()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count integer;
BEGIN
  UPDATE public.email_outbox
     SET status = 'expired',
         dlq_at = now(),
         dlq_reason = COALESCE(dlq_reason, 'ttl_expired'),
         updated_at = now()
   WHERE status IN ('pending','sending')
     AND expires_at IS NOT NULL
     AND expires_at <= now();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.expire_stale_pending_v2() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_stale_pending_v2() TO service_role;

CREATE OR REPLACE FUNCTION public.email_v2_lane_metrics()
RETURNS TABLE (
  lane text,
  pending_count bigint,
  sending_count bigint,
  sent_1h bigint,
  dlq_1h bigint,
  p50_latency_ms numeric,
  p95_latency_ms numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH lanes AS (SELECT unnest(ARRAY['auth','tx','bulk']) AS l_name),
  agg AS (
    SELECT
      o.lane AS l_name,
      count(*) FILTER (WHERE o.status='pending')::bigint AS pending_count,
      count(*) FILTER (WHERE o.status='sending')::bigint AS sending_count,
      count(*) FILTER (WHERE o.status='sent' AND o.sent_at > now() - interval '1 hour')::bigint AS sent_1h,
      count(*) FILTER (WHERE o.status='dlq' AND o.dlq_at > now() - interval '1 hour')::bigint AS dlq_1h,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (o.sent_at - o.created_at)) * 1000)
        FILTER (WHERE o.status='sent' AND o.sent_at > now() - interval '1 hour') AS p50_latency_ms,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (o.sent_at - o.created_at)) * 1000)
        FILTER (WHERE o.status='sent' AND o.sent_at > now() - interval '1 hour') AS p95_latency_ms
    FROM public.email_outbox o
    WHERE o.created_at > now() - interval '24 hours' OR o.status IN ('pending','sending')
    GROUP BY o.lane
  )
  SELECT
    l.l_name,
    COALESCE(a.pending_count, 0),
    COALESCE(a.sending_count, 0),
    COALESCE(a.sent_1h, 0),
    COALESCE(a.dlq_1h, 0),
    a.p50_latency_ms,
    a.p95_latency_ms
  FROM lanes l
  LEFT JOIN agg a ON a.l_name = l.l_name
  ORDER BY CASE l.l_name WHEN 'auth' THEN 1 WHEN 'tx' THEN 2 ELSE 3 END;
$$;
REVOKE ALL ON FUNCTION public.email_v2_lane_metrics() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.email_v2_lane_metrics() TO authenticated, service_role;

DO $$ BEGIN PERFORM cron.unschedule('email-v2-expire-stale'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('email-v2-gc-retention'); EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule('email-v2-expire-stale', '*/5 * * * *',
  $cron$ SELECT public.expire_stale_pending_v2(); $cron$);

SELECT cron.schedule('email-v2-gc-retention', '30 3 * * *',
  $cron$ SELECT public.gc_expired_email_outbox(); $cron$);
