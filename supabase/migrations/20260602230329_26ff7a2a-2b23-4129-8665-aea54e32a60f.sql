
-- ============================================================
-- WAVE 1: Foundation tables for refactor (additive only)
-- ============================================================

-- 1. Audit sink registry --------------------------------------
CREATE TABLE IF NOT EXISTS public.audit_sink_registry (
  table_name  TEXT PRIMARY KEY,
  mode        TEXT NOT NULL CHECK (mode IN ('semantic','generic','none')),
  sink        TEXT NOT NULL CHECK (sink IN ('audit_log','ops_events','ops_metrics','none')),
  notes       TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.audit_sink_registry TO authenticated;
GRANT ALL    ON public.audit_sink_registry TO service_role;
ALTER TABLE  public.audit_sink_registry ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read audit_sink_registry"
  ON public.audit_sink_registry FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 2. ops_events: high-volume telemetry sink -------------------
CREATE TABLE IF NOT EXISTS public.ops_events (
  id            BIGSERIAL PRIMARY KEY,
  event_day     DATE NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::date,
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  kind          TEXT NOT NULL,
  severity      TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warn','error')),
  actor_id      UUID,
  ref_table     TEXT,
  ref_id        TEXT,
  payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- 90-day retention helper (purge worker reads this)
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '90 days')
);
CREATE INDEX IF NOT EXISTS idx_ops_events_kind_day   ON public.ops_events(kind, event_day DESC);
CREATE INDEX IF NOT EXISTS idx_ops_events_actor_day  ON public.ops_events(actor_id, event_day DESC) WHERE actor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ops_events_expires    ON public.ops_events(expires_at);
GRANT SELECT ON public.ops_events TO authenticated;
GRANT ALL    ON public.ops_events TO service_role;
ALTER TABLE  public.ops_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read ops_events"
  ON public.ops_events FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 3. ops_metrics: daily-rolled counters -----------------------
CREATE TABLE IF NOT EXISTS public.ops_metrics (
  metric_day    DATE NOT NULL,
  metric_key    TEXT NOT NULL,
  metric_value  NUMERIC NOT NULL DEFAULT 0,
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (metric_day, metric_key)
);
GRANT SELECT ON public.ops_metrics TO authenticated;
GRANT ALL    ON public.ops_metrics TO service_role;
ALTER TABLE  public.ops_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read ops_metrics"
  ON public.ops_metrics FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 4. record_event() single write path -------------------------
CREATE OR REPLACE FUNCTION public.record_event(
  p_sink     TEXT,
  p_kind     TEXT,
  p_actor    UUID DEFAULT NULL,
  p_payload  JSONB DEFAULT '{}'::jsonb,
  p_severity TEXT DEFAULT 'info',
  p_ref_table TEXT DEFAULT NULL,
  p_ref_id    TEXT DEFAULT NULL
) RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id BIGINT;
BEGIN
  IF p_sink NOT IN ('audit_log','ops_events','ops_metrics') THEN
    RAISE EXCEPTION 'record_event: invalid sink %', p_sink;
  END IF;
  IF p_severity NOT IN ('info','warn','error') THEN
    p_severity := 'info';
  END IF;

  IF p_sink = 'ops_events' THEN
    INSERT INTO public.ops_events (kind, severity, actor_id, ref_table, ref_id, payload)
    VALUES (p_kind, p_severity, p_actor, p_ref_table, p_ref_id, COALESCE(p_payload,'{}'::jsonb))
    RETURNING id INTO v_id;
    RETURN v_id;

  ELSIF p_sink = 'ops_metrics' THEN
    INSERT INTO public.ops_metrics (metric_day, metric_key, metric_value, metadata)
    VALUES ((now() AT TIME ZONE 'utc')::date, p_kind,
            COALESCE((p_payload->>'value')::numeric, 1),
            p_payload - 'value')
    ON CONFLICT (metric_day, metric_key)
    DO UPDATE SET metric_value = ops_metrics.metric_value + EXCLUDED.metric_value,
                  updated_at = now();
    RETURN 0;

  ELSE
    -- audit_log: delegate to existing append-only writer when present.
    -- Fallback: noop (do not insert directly so we don't break hash chain).
    BEGIN
      PERFORM public.append_audit_log_entry(p_kind, p_actor, p_payload, p_severity);
    EXCEPTION WHEN undefined_function THEN
      -- audit_log is hash-chained and managed by its own writer; skip silently.
      NULL;
    END;
    RETURN 0;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.record_event(TEXT,TEXT,UUID,JSONB,TEXT,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_event(TEXT,TEXT,UUID,JSONB,TEXT,TEXT,TEXT) TO service_role;

-- 5. Request idempotency table --------------------------------
CREATE TABLE IF NOT EXISTS public.request_idempotency (
  key           TEXT PRIMARY KEY,
  user_id       UUID,
  request_hash  TEXT NOT NULL,
  response_json JSONB,
  status_code   INT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '24 hours')
);
CREATE INDEX IF NOT EXISTS idx_request_idempotency_expires ON public.request_idempotency(expires_at);
CREATE INDEX IF NOT EXISTS idx_request_idempotency_user    ON public.request_idempotency(user_id, created_at DESC) WHERE user_id IS NOT NULL;
GRANT ALL ON public.request_idempotency TO service_role;
ALTER TABLE public.request_idempotency ENABLE ROW LEVEL SECURITY;
-- service-role only; no anon/authenticated policies (the edge fn helper uses service role).

-- 6. Email templates catalog ----------------------------------
CREATE TABLE IF NOT EXISTS public.email_templates (
  slug                      TEXT PRIMARY KEY,
  lane                      TEXT NOT NULL CHECK (lane IN ('auth_emails','transactional_emails','bulk_emails')),
  purpose                   TEXT NOT NULL,
  default_headers           JSONB NOT NULL DEFAULT '{}'::jsonb,
  frequency_cap_applies     BOOLEAN NOT NULL DEFAULT FALSE,
  list_unsubscribe_path     TEXT,
  notes                     TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.email_templates TO authenticated;
GRANT ALL    ON public.email_templates TO service_role;
ALTER TABLE  public.email_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read email_templates"
  ON public.email_templates FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 7. Notifications optional idempotency key -------------------
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS notifications_idempotency_unique
  ON public.notifications(idempotency_key)
  WHERE idempotency_key IS NOT NULL;
