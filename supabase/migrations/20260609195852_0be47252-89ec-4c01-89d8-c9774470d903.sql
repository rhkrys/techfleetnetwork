
-- ===== Email subsystem v2: single Outbox + adaptive scheduler ======================
-- Strangler-fig migration. The legacy pgmq + email_send_log + email_send_state
-- pipeline stays live; this adds the canonical Outbox + policy + dispatcher
-- surface so v2 can run behind email_pipeline_v2_enabled per-lane bitmask.
-- Decommission lives in a future migration after 72h soak at 100%.

-- 1. Feature flag (per-lane bitmask: 1=auth, 2=transactional, 4=bulk)
ALTER TABLE public.email_send_state
  ADD COLUMN IF NOT EXISTS pipeline_v2_lanes_bitmask integer NOT NULL DEFAULT 0;
COMMENT ON COLUMN public.email_send_state.pipeline_v2_lanes_bitmask IS
  'Per-lane v2 enable bitmask: 1=auth, 2=transactional, 4=bulk. 0 = legacy pipeline.';

-- 2. Policy config (single row, hot-reloadable knobs)
CREATE TABLE IF NOT EXISTS public.email_policy_config (
  id              integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  -- BackoffStrategy
  base_backoff_seconds        integer NOT NULL DEFAULT 60,
  max_backoff_seconds         integer NOT NULL DEFAULT 900,
  workspace_quota_cap_seconds integer NOT NULL DEFAULT 120,
  -- CircuitBreaker
  cb_open_threshold_429s      integer NOT NULL DEFAULT 3,
  cb_open_window_seconds      integer NOT NULL DEFAULT 600,
  cb_half_open_probe_seconds  integer NOT NULL DEFAULT 30,
  cb_close_success_threshold  integer NOT NULL DEFAULT 5,
  -- Scheduler
  max_batch_size              integer NOT NULL DEFAULT 25,
  min_send_gap_ms             integer NOT NULL DEFAULT 500,
  -- Retention
  pending_expiry_minutes      integer NOT NULL DEFAULT 60,
  auth_pending_expiry_minutes integer NOT NULL DEFAULT 15,
  dlq_retention_days          integer NOT NULL DEFAULT 30,
  updated_at                  timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.email_policy_config (id) VALUES (1) ON CONFLICT DO NOTHING;
GRANT SELECT ON public.email_policy_config TO authenticated;
GRANT ALL ON public.email_policy_config TO service_role;
ALTER TABLE public.email_policy_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read policy" ON public.email_policy_config FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "service writes policy" ON public.email_policy_config FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- 3. Circuit-breaker state per lane (3 rows seeded)
CREATE TABLE IF NOT EXISTS public.email_lane_state (
  lane                text PRIMARY KEY CHECK (lane IN ('auth','transactional','bulk')),
  circuit_state       text NOT NULL DEFAULT 'closed' CHECK (circuit_state IN ('closed','open','half_open')),
  opened_at           timestamptz,
  probe_at            timestamptz,
  recent_429_count    integer NOT NULL DEFAULT 0,
  recent_429_window_start timestamptz,
  consecutive_success integer NOT NULL DEFAULT 0,
  paused_by_admin     boolean NOT NULL DEFAULT false,
  paused_reason       text,
  updated_at          timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.email_lane_state (lane) VALUES ('auth'), ('transactional'), ('bulk')
  ON CONFLICT DO NOTHING;
GRANT SELECT ON public.email_lane_state TO authenticated;
GRANT ALL ON public.email_lane_state TO service_role;
ALTER TABLE public.email_lane_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read lane state" ON public.email_lane_state FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "service writes lane state" ON public.email_lane_state FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- 4. Single Outbox (canonical store)
CREATE TABLE IF NOT EXISTS public.email_outbox (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lane              text NOT NULL CHECK (lane IN ('auth','transactional','bulk')),
  template          text NOT NULL,
  recipient         text NOT NULL,
  subject           text,
  payload           jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key   text NOT NULL,
  message_id        text NOT NULL,
  status            text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','sending','sent','dlq','suppressed','expired')),
  attempts          integer NOT NULL DEFAULT 0,
  attempt_history   jsonb NOT NULL DEFAULT '[]'::jsonb,
  next_attempt_at   timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz NOT NULL,
  last_error        text,
  last_status_code  integer,
  dlq_reason        text,
  run_id            uuid,
  trace_id          text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  claimed_at        timestamptz,
  sent_at           timestamptz,
  dlq_at            timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS email_outbox_idem_uniq
  ON public.email_outbox (idempotency_key);
CREATE INDEX IF NOT EXISTS email_outbox_due_idx
  ON public.email_outbox (lane, next_attempt_at)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS email_outbox_status_idx
  ON public.email_outbox (status, created_at DESC);
CREATE INDEX IF NOT EXISTS email_outbox_recipient_idx
  ON public.email_outbox (recipient, created_at DESC);
GRANT ALL ON public.email_outbox TO service_role;
ALTER TABLE public.email_outbox ENABLE ROW LEVEL SECURITY;
-- Deny-all RLS; admins read via get_email_outbox RPC (separate, payload-scrubbed)
CREATE POLICY "service writes outbox" ON public.email_outbox FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- 5. Scheduler RPC: claim_due_emails (FOR UPDATE SKIP LOCKED, fairness-aware)
CREATE OR REPLACE FUNCTION public.claim_due_emails(p_max integer DEFAULT 25)
RETURNS TABLE (
  id uuid, lane text, template text, recipient text, subject text,
  payload jsonb, idempotency_key text, message_id text, attempts integer, trace_id text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_now timestamptz := now();
BEGIN
  RETURN QUERY
  WITH lane_open AS (
    -- Lane is eligible only if circuit closed (or half-open past probe_at) and not paused
    SELECT s.lane
    FROM email_lane_state s
    WHERE s.paused_by_admin = false
      AND (
        s.circuit_state = 'closed'
        OR (s.circuit_state = 'half_open' AND (s.probe_at IS NULL OR s.probe_at <= v_now))
        OR (s.circuit_state = 'open' AND s.probe_at IS NOT NULL AND s.probe_at <= v_now)
      )
  ),
  -- Fairness: priority order auth → transactional → bulk
  prioritized AS (
    SELECT o.*,
      CASE o.lane WHEN 'auth' THEN 1 WHEN 'transactional' THEN 2 ELSE 3 END AS prio
    FROM email_outbox o
    JOIN lane_open lo ON lo.lane = o.lane
    WHERE o.status = 'pending'
      AND o.next_attempt_at <= v_now
      AND o.expires_at > v_now
    ORDER BY prio, o.next_attempt_at
    LIMIT p_max
    FOR UPDATE OF o SKIP LOCKED
  ),
  claimed AS (
    UPDATE email_outbox o
    SET status = 'sending', claimed_at = v_now, updated_at = v_now
    FROM prioritized p
    WHERE o.id = p.id
    RETURNING o.id, o.lane, o.template, o.recipient, o.subject, o.payload,
              o.idempotency_key, o.message_id, o.attempts, o.trace_id
  )
  SELECT * FROM claimed;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_due_emails(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_emails(integer) TO service_role;

-- 6. record_attempt_result: encodes BackoffStrategy + CircuitBreaker transitions
CREATE OR REPLACE FUNCTION public.record_email_attempt_result(
  p_id              uuid,
  p_outcome         text,           -- 'sent' | 'rate_limited' | 'error' | 'permanent_fail' | 'suppressed'
  p_status_code     integer DEFAULT NULL,
  p_error           text DEFAULT NULL,
  p_retry_after_s   integer DEFAULT NULL,
  p_workspace_quota boolean DEFAULT false
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_cfg     email_policy_config%ROWTYPE;
  v_row     email_outbox%ROWTYPE;
  v_lane    email_lane_state%ROWTYPE;
  v_now     timestamptz := now();
  v_attempt integer;
  v_next    timestamptz;
  v_cap     integer;
  v_base    integer;
  v_secs    integer;
BEGIN
  SELECT * INTO v_cfg FROM email_policy_config WHERE id = 1;
  SELECT * INTO v_row FROM email_outbox WHERE id = p_id;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO v_lane FROM email_lane_state WHERE lane = v_row.lane FOR UPDATE;

  v_attempt := v_row.attempts + 1;

  IF p_outcome = 'sent' THEN
    UPDATE email_outbox SET
      status = 'sent', attempts = v_attempt, sent_at = v_now, updated_at = v_now,
      last_status_code = p_status_code, last_error = NULL,
      attempt_history = attempt_history || jsonb_build_object('t', v_now, 'outcome','sent','code',p_status_code)
    WHERE id = p_id;

    -- CircuitBreaker: success closes from half_open after threshold; resets recent_429 window
    UPDATE email_lane_state SET
      consecutive_success = consecutive_success + 1,
      circuit_state = CASE
        WHEN circuit_state = 'half_open'
             AND consecutive_success + 1 >= v_cfg.cb_close_success_threshold
        THEN 'closed' ELSE circuit_state END,
      opened_at = CASE WHEN circuit_state = 'half_open'
             AND consecutive_success + 1 >= v_cfg.cb_close_success_threshold
        THEN NULL ELSE opened_at END,
      probe_at  = CASE WHEN circuit_state = 'half_open'
             AND consecutive_success + 1 >= v_cfg.cb_close_success_threshold
        THEN NULL ELSE probe_at END,
      recent_429_count = 0,
      recent_429_window_start = NULL,
      updated_at = v_now
    WHERE lane = v_row.lane;
    RETURN;
  END IF;

  IF p_outcome = 'suppressed' THEN
    UPDATE email_outbox SET status='suppressed', updated_at=v_now,
      last_error='recipient suppressed' WHERE id=p_id;
    RETURN;
  END IF;

  IF p_outcome = 'permanent_fail' THEN
    UPDATE email_outbox SET status='dlq', dlq_at=v_now, dlq_reason=COALESCE(p_error,'permanent_fail'),
      last_status_code=p_status_code, attempts=v_attempt, updated_at=v_now,
      attempt_history = attempt_history || jsonb_build_object('t',v_now,'outcome','permanent_fail','code',p_status_code,'err',p_error)
    WHERE id=p_id;
    RETURN;
  END IF;

  -- Retryable: compute backoff
  v_cap  := CASE WHEN p_workspace_quota THEN v_cfg.workspace_quota_cap_seconds ELSE v_cfg.max_backoff_seconds END;
  v_base := CASE WHEN p_workspace_quota THEN LEAST(30, v_cfg.base_backoff_seconds) ELSE v_cfg.base_backoff_seconds END;
  v_secs := LEAST(GREATEST(COALESCE(p_retry_after_s,0), v_base * (2 ^ LEAST(v_attempt-1,8))::int), v_cap);
  v_next := v_now + (v_secs || ' seconds')::interval;

  -- DLQ on max attempts (8) or past expiry
  IF v_attempt >= 8 OR v_row.expires_at <= v_now THEN
    UPDATE email_outbox SET status='dlq', dlq_at=v_now,
      dlq_reason=COALESCE(p_error, CASE WHEN v_attempt >= 8 THEN 'max_attempts' ELSE 'expired' END),
      last_status_code=p_status_code, attempts=v_attempt, updated_at=v_now,
      attempt_history = attempt_history || jsonb_build_object('t',v_now,'outcome','dlq','code',p_status_code,'err',p_error)
    WHERE id=p_id;
  ELSE
    UPDATE email_outbox SET status='pending', next_attempt_at=v_next, attempts=v_attempt,
      last_error=p_error, last_status_code=p_status_code, updated_at=v_now,
      attempt_history = attempt_history || jsonb_build_object('t',v_now,'outcome',p_outcome,'code',p_status_code,'err',p_error,'next',v_next)
    WHERE id=p_id;
  END IF;

  -- CircuitBreaker: 429 advances the breaker
  IF p_outcome = 'rate_limited' THEN
    UPDATE email_lane_state SET
      consecutive_success = 0,
      recent_429_window_start = CASE
        WHEN recent_429_window_start IS NULL
          OR recent_429_window_start < v_now - (v_cfg.cb_open_window_seconds || ' seconds')::interval
        THEN v_now ELSE recent_429_window_start END,
      recent_429_count = CASE
        WHEN recent_429_window_start IS NULL
          OR recent_429_window_start < v_now - (v_cfg.cb_open_window_seconds || ' seconds')::interval
        THEN 1 ELSE recent_429_count + 1 END,
      updated_at = v_now
    WHERE lane = v_row.lane;

    UPDATE email_lane_state SET
      circuit_state = 'open',
      opened_at = v_now,
      probe_at  = v_now + (v_cfg.cb_half_open_probe_seconds || ' seconds')::interval
    WHERE lane = v_row.lane
      AND circuit_state = 'closed'
      AND recent_429_count >= v_cfg.cb_open_threshold_429s;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.record_email_attempt_result(uuid,text,integer,text,integer,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_email_attempt_result(uuid,text,integer,text,integer,boolean) TO service_role;

-- 7. Admin controls: pause/resume lane, force-expire stale, half-open probe
CREATE OR REPLACE FUNCTION public.pause_email_lane(p_lane text, p_reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'admin only'; END IF;
  UPDATE public.email_lane_state SET paused_by_admin = true, paused_reason = p_reason, updated_at = now()
   WHERE lane = p_lane;
END $$;
REVOKE ALL ON FUNCTION public.pause_email_lane(text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pause_email_lane(text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.resume_email_lane(p_lane text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'admin only'; END IF;
  UPDATE public.email_lane_state SET
    paused_by_admin = false, paused_reason = NULL,
    circuit_state = 'closed', opened_at = NULL, probe_at = NULL,
    recent_429_count = 0, recent_429_window_start = NULL, consecutive_success = 0,
    updated_at = now()
   WHERE lane = p_lane;
END $$;
REVOKE ALL ON FUNCTION public.resume_email_lane(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resume_email_lane(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.gc_expired_email_outbox()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count integer;
BEGIN
  WITH expired AS (
    UPDATE public.email_outbox
       SET status='expired', updated_at=now()
     WHERE status='pending' AND expires_at <= now()
    RETURNING 1
  ) SELECT count(*) INTO v_count FROM expired;
  RETURN v_count;
END $$;
REVOKE ALL ON FUNCTION public.gc_expired_email_outbox() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gc_expired_email_outbox() TO service_role;

-- 8. Admin read-RPC (payload scrubbed by default)
CREATE OR REPLACE FUNCTION public.get_email_outbox(
  p_lane text DEFAULT NULL, p_status text DEFAULT NULL, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0
) RETURNS TABLE (
  id uuid, lane text, template text, recipient text, status text, attempts integer,
  next_attempt_at timestamptz, sent_at timestamptz, dlq_at timestamptz, dlq_reason text,
  last_error text, last_status_code integer, created_at timestamptz
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'admin only'; END IF;
  RETURN QUERY
    SELECT o.id,o.lane,o.template,o.recipient,o.status,o.attempts,o.next_attempt_at,
           o.sent_at,o.dlq_at,o.dlq_reason,o.last_error,o.last_status_code,o.created_at
      FROM public.email_outbox o
     WHERE (p_lane IS NULL OR o.lane=p_lane)
       AND (p_status IS NULL OR o.status=p_status)
     ORDER BY o.created_at DESC
     LIMIT p_limit OFFSET p_offset;
END $$;
REVOKE ALL ON FUNCTION public.get_email_outbox(text,text,integer,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_email_outbox(text,text,integer,integer) TO authenticated;

-- 9. enqueue_email_v2: idempotent enqueue from EnqueueEmail use-case
CREATE OR REPLACE FUNCTION public.enqueue_email_v2(
  p_lane text, p_template text, p_recipient text, p_subject text,
  p_payload jsonb, p_idempotency_key text, p_message_id text, p_trace_id text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cfg    email_policy_config%ROWTYPE;
  v_id     uuid;
  v_exp    timestamptz;
BEGIN
  SELECT * INTO v_cfg FROM email_policy_config WHERE id=1;
  v_exp := now() + (
    CASE WHEN p_lane='auth' THEN v_cfg.auth_pending_expiry_minutes
         ELSE v_cfg.pending_expiry_minutes END || ' minutes')::interval;

  INSERT INTO public.email_outbox (lane, template, recipient, subject, payload,
    idempotency_key, message_id, expires_at, trace_id)
  VALUES (p_lane, p_template, p_recipient, p_subject, COALESCE(p_payload,'{}'::jsonb),
    p_idempotency_key, p_message_id, v_exp, p_trace_id)
  ON CONFLICT (idempotency_key) DO UPDATE SET updated_at = now()
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.enqueue_email_v2(text,text,text,text,jsonb,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_email_v2(text,text,text,text,jsonb,text,text,text) TO service_role;
