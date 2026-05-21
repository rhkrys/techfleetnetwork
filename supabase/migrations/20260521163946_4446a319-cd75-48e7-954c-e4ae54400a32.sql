-- Phase 3.3 + 5.3: email health snapshot + auto-pause + warm-up cron

-- 1. Compute 7-day rates from deduped email_send_log
CREATE OR REPLACE FUNCTION public.compute_email_domain_health(p_since TIMESTAMPTZ)
RETURNS TABLE (
  sent BIGINT,
  bounced BIGINT,
  complained BIGINT,
  complaint_rate NUMERIC,
  bounce_rate NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH latest AS (
    SELECT DISTINCT ON (message_id) message_id, status, created_at
    FROM public.email_send_log
    WHERE message_id IS NOT NULL AND created_at >= p_since
    ORDER BY message_id, created_at DESC
  )
  SELECT
    COUNT(*) FILTER (WHERE status = 'sent')::BIGINT AS sent,
    COUNT(*) FILTER (WHERE status = 'bounced')::BIGINT AS bounced,
    COUNT(*) FILTER (WHERE status = 'complained')::BIGINT AS complained,
    CASE WHEN COUNT(*) FILTER (WHERE status = 'sent') > 0
         THEN COUNT(*) FILTER (WHERE status = 'complained')::NUMERIC
              / COUNT(*) FILTER (WHERE status = 'sent')::NUMERIC
         ELSE 0 END AS complaint_rate,
    CASE WHEN COUNT(*) FILTER (WHERE status = 'sent') > 0
         THEN COUNT(*) FILTER (WHERE status = 'bounced')::NUMERIC
              / COUNT(*) FILTER (WHERE status = 'sent')::NUMERIC
         ELSE 0 END AS bounce_rate
  FROM latest;
$$;

REVOKE ALL ON FUNCTION public.compute_email_domain_health(TIMESTAMPTZ) FROM anon, authenticated;

-- 2. Add bounce_rate column to email_domain_health if missing
ALTER TABLE public.email_domain_health
  ADD COLUMN IF NOT EXISTS bounce_rate NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS window_end TIMESTAMPTZ;

-- 3. Materialized view for fast dashboard reads
DROP MATERIALIZED VIEW IF EXISTS public.email_health_snapshot;
CREATE MATERIALIZED VIEW public.email_health_snapshot AS
WITH latest AS (
  SELECT DISTINCT ON (message_id) message_id, template_name, status, created_at
  FROM public.email_send_log
  WHERE message_id IS NOT NULL
    AND created_at >= NOW() - INTERVAL '7 days'
  ORDER BY message_id, created_at DESC
)
SELECT
  template_name,
  COUNT(*) FILTER (WHERE status = 'sent') AS sent,
  COUNT(*) FILTER (WHERE status = 'bounced') AS bounced,
  COUNT(*) FILTER (WHERE status = 'complained') AS complained,
  COUNT(*) FILTER (WHERE status = 'suppressed') AS suppressed,
  COUNT(*) FILTER (WHERE status = 'rate_limited') AS rate_limited,
  COUNT(*) FILTER (WHERE status = 'frequency_capped') AS frequency_capped,
  COUNT(*) FILTER (WHERE status = 'dlq') AS dlq,
  COUNT(*) AS total,
  NOW() AS snapshot_at
FROM latest
GROUP BY template_name;

CREATE UNIQUE INDEX IF NOT EXISTS email_health_snapshot_template_idx
  ON public.email_health_snapshot (template_name);

REVOKE ALL ON public.email_health_snapshot FROM anon, authenticated;

-- 4. Refresh function (callable from edge function)
CREATE OR REPLACE FUNCTION public.refresh_email_health_snapshot()
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.email_health_snapshot;
$$;

REVOKE ALL ON FUNCTION public.refresh_email_health_snapshot() FROM anon, authenticated;