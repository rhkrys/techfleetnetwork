CREATE TABLE IF NOT EXISTS public.email_workspace_throttle (
  id                  int PRIMARY KEY DEFAULT 1,
  tokens              numeric NOT NULL DEFAULT 5,
  capacity            numeric NOT NULL DEFAULT 5,
  refill_per_s        numeric NOT NULL DEFAULT 2.0,
  min_refill          numeric NOT NULL DEFAULT 0.5,
  max_refill          numeric NOT NULL DEFAULT 4.0,
  last_refill_at      timestamptz NOT NULL DEFAULT now(),
  last_429_at         timestamptz,
  successes_since_429 int NOT NULL DEFAULT 0,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (id = 1)
);

GRANT SELECT ON public.email_workspace_throttle TO authenticated;
GRANT ALL ON public.email_workspace_throttle TO service_role;

ALTER TABLE public.email_workspace_throttle ENABLE ROW LEVEL SECURITY;

CREATE POLICY "throttle_admin_read" ON public.email_workspace_throttle
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

INSERT INTO public.email_workspace_throttle (id) VALUES (1)
  ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.consume_workspace_email_token(p_count int DEFAULT 1)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r          public.email_workspace_throttle%ROWTYPE;
  now_ts     timestamptz := now();
  elapsed_s  numeric;
  new_tokens numeric;
  deficit    numeric;
BEGIN
  SELECT * INTO r FROM public.email_workspace_throttle WHERE id = 1 FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.email_workspace_throttle (id) VALUES (1) RETURNING * INTO r;
  END IF;

  elapsed_s := GREATEST(0, EXTRACT(EPOCH FROM (now_ts - r.last_refill_at)));
  new_tokens := LEAST(r.capacity, r.tokens + elapsed_s * r.refill_per_s);

  IF new_tokens >= p_count THEN
    UPDATE public.email_workspace_throttle
       SET tokens = new_tokens - p_count, last_refill_at = now_ts, updated_at = now_ts
     WHERE id = 1;
    RETURN 0;
  END IF;

  deficit := p_count - new_tokens;
  UPDATE public.email_workspace_throttle
     SET tokens = new_tokens, last_refill_at = now_ts, updated_at = now_ts
   WHERE id = 1;
  RETURN CEIL((deficit / NULLIF(r.refill_per_s, 0)) * 1000)::int;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_workspace_email_token(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_workspace_email_token(int) TO service_role;

CREATE OR REPLACE FUNCTION public.record_workspace_email_429()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.email_workspace_throttle
     SET refill_per_s = GREATEST(min_refill, refill_per_s / 2.0),
         tokens = 0,
         last_429_at = now(),
         successes_since_429 = 0,
         updated_at = now()
   WHERE id = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.record_workspace_email_429() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_workspace_email_429() TO service_role;

CREATE OR REPLACE FUNCTION public.record_workspace_email_success()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.email_workspace_throttle%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.email_workspace_throttle WHERE id = 1 FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  IF r.successes_since_429 + 1 >= 500 THEN
    UPDATE public.email_workspace_throttle
       SET refill_per_s = LEAST(max_refill, refill_per_s * 1.1),
           successes_since_429 = 0,
           updated_at = now()
     WHERE id = 1;
  ELSE
    UPDATE public.email_workspace_throttle
       SET successes_since_429 = successes_since_429 + 1,
           updated_at = now()
     WHERE id = 1;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.record_workspace_email_success() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_workspace_email_success() TO service_role;

UPDATE public.agent_fix_queue
   SET status = 'resolved',
       resolved_at = now(),
       dismissed_reason = 'Superseded by workspace token bucket EMAIL-RL-010..014. Proactive pacer prevents workspace-quota 429s; per-lane cooldown remains as second line of defense.'
 WHERE event_type = 'email_rate_limited'
   AND status IN ('pending', 'triaged', 'proposed');

INSERT INTO public.bdd_scenarios (feature_area, feature_area_number, scenario_id, title, gherkin) VALUES
  ('Email Workspace Throttle', 10, 'EMAIL-RL-010', 'Bucket empty — worker exits cleanly',
   'Feature: Workspace email throttle
  Scenario: EMAIL-RL-010
    Given email_workspace_throttle has 0 tokens and refill_per_s=2.0
    When process-email-queue attempts a transactional send
    Then [Code] consume_workspace_email_token returns wait_ms > 0
    And [Code] the worker breaks the lane loop without calling the provider
    And [DB] the message stays in pgmq for the next cron tick
    And [UI] no agent_fix_queue row is created'),
  ('Email Workspace Throttle', 10, 'EMAIL-RL-011', 'Sustained success ratchets refill up',
   'Feature: Workspace email throttle
  Scenario: EMAIL-RL-011
    Given refill_per_s=2.0 and successes_since_429=499
    When record_workspace_email_success() runs once more
    Then [DB] refill_per_s becomes 2.2 (capped at max_refill=4.0)
    And [DB] successes_since_429 resets to 0
    And [Code] subsequent consume calls accumulate 10% faster'),
  ('Email Workspace Throttle', 10, 'EMAIL-RL-012', '429 halves refill rate immediately',
   'Feature: Workspace email throttle
  Scenario: EMAIL-RL-012
    Given refill_per_s=2.0
    When record_workspace_email_429() runs
    Then [DB] refill_per_s becomes 1.0 (floor min_refill=0.5)
    And [DB] tokens resets to 0
    And [DB] last_429_at = now()
    And [Code] next consume returns wait_ms >= 1000'),
  ('Email Workspace Throttle', 10, 'EMAIL-RL-013', 'Concurrent isolates cannot double-spend',
   'Feature: Workspace email throttle
  Scenario: EMAIL-RL-013
    Given 3 isolates running concurrently
    And tokens=2 and refill_per_s=2.0
    When all 3 call consume_workspace_email_token(1) within 100ms
    Then [DB] exactly 2 calls return 0 and 1 returns wait_ms > 0
    And [DB] tokens after settlement is 0
    And [Code] only 2 provider sends are attempted'),
  ('Email Workspace Throttle', 10, 'EMAIL-RL-014', 'Per-lane cooldown stays at zero in steady state',
   'Feature: Workspace email throttle
  Scenario: EMAIL-RL-014
    Given email_workspace_throttle is healthy (refill_per_s>=2.0)
    When 1000 sends process across all lanes over 1h
    Then [DB] transactional_consecutive_rate_limits remains 0
    And [DB] auth_consecutive_rate_limits remains 0
    And [DB] no email_rate_limited row appears in agent_fix_queue
    And [UI] System Health > Email tab shows green for all lanes')
ON CONFLICT (scenario_id) DO UPDATE SET gherkin = EXCLUDED.gherkin, title = EXCLUDED.title;