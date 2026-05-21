
-- Warm-up + circuit breaker columns on email_send_state
ALTER TABLE public.email_send_state
  ADD COLUMN IF NOT EXISTS bulk_hourly_cap integer NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS bulk_paused boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS bulk_warmup_started_at timestamptz NOT NULL DEFAULT now();

-- Extend email_send_log status check to allow new lifecycle states
ALTER TABLE public.email_send_log DROP CONSTRAINT IF EXISTS email_send_log_status_check;
ALTER TABLE public.email_send_log ADD CONSTRAINT email_send_log_status_check
  CHECK (status = ANY (ARRAY[
    'pending','sent','suppressed','failed','bounced','complained','dlq',
    'rate_limited','frequency_capped'
  ]));

-- 7-day rolling domain reputation rollup
CREATE TABLE IF NOT EXISTS public.email_domain_health (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  recipient_domain text NOT NULL,
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  sent_count integer NOT NULL DEFAULT 0,
  bounced_count integer NOT NULL DEFAULT 0,
  complained_count integer NOT NULL DEFAULT 0,
  complaint_rate numeric(6,4) NOT NULL DEFAULT 0,
  bounce_rate numeric(6,4) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (recipient_domain, window_start)
);
CREATE INDEX IF NOT EXISTS email_domain_health_window_idx
  ON public.email_domain_health (window_end DESC, recipient_domain);

ALTER TABLE public.email_domain_health ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins read email_domain_health" ON public.email_domain_health;
CREATE POLICY "Admins read email_domain_health" ON public.email_domain_health
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));
