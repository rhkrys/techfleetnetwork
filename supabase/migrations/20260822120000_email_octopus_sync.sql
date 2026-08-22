-- PR 6 (email rearchitecture): Email Octopus marketing sync — durable desired-state reconciliation.
--
-- ADR-0017: Email Octopus is the marketing source of truth; the platform is the front door. A member
-- opts in/out at signup and in the profile; that intent is recorded locally and pushed to EO by a
-- background worker with retry + backoff, NEVER synchronously on the request path (fail-open: signup
-- and profile-save succeed even if EO is down; a dropped opt-out is a compliance breach, so the queue
-- guarantees eventual delivery).
--
-- Model: DESIRED STATE, one row per contact email (not an op log). Each opt-in/out UPSERTs the row's
-- desired_status and bumps `version`. The worker pushes the current desired_status and, using the
-- claimed version for optimistic concurrency, marks it synced only if no newer intent arrived
-- meanwhile. This collapses rapid toggles to the latest intent and makes out-of-order application
-- impossible (the bug a naive per-op FIFO queue would have). Mirrors the email_outbox claim/settle
-- pattern (20260609195852): FOR UPDATE SKIP LOCKED claim, exponential backoff, DLQ at 8 attempts.
--
-- Feature flag: there is no separate flag table; the sync is gated by the presence of the EO secrets
-- (EMAILOCTOPUS_API_KEY / EMAILOCTOPUS_LIST_ID) in the worker — absent = fails closed, rows stay
-- pending and surface as backlog. Intent is always recorded locally regardless.

-- 1. Minimal local receipt (compliance proof + retry support only; NOT authoritative, never gates a
--    send). EO holds the authoritative subscription state.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS marketing_opt_in_at     timestamptz,
  ADD COLUMN IF NOT EXISTS marketing_opt_in_source text;

COMMENT ON COLUMN public.profiles.marketing_opt_in_at IS
  'When the member last opted in to marketing email (Email Octopus). Local receipt only; EO is the '
  'source of truth (ADR-0017). Null when not currently opted in. Never read to gate a send.';
COMMENT ON COLUMN public.profiles.marketing_opt_in_source IS
  'Where the current marketing opt-in happened: signup | profile | import. Local receipt only.';

-- 2. Desired-state sync table: one row per contact email.
CREATE TABLE IF NOT EXISTS public.email_octopus_contact_sync (
  email            text PRIMARY KEY,                      -- lowercased contact email = EO identity
  user_id          uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  desired_status   text NOT NULL CHECK (desired_status IN ('subscribed', 'unsubscribed', 'deleted')),
  fields           jsonb NOT NULL DEFAULT '{}'::jsonb,    -- raw personalization (e.g. {"first_name": ...})
  version          bigint NOT NULL DEFAULT 1,             -- bumped on each intent change
  synced_version   bigint NOT NULL DEFAULT 0,             -- last version confirmed pushed to EO
  status           text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'syncing', 'synced', 'dlq')),
  attempts         integer NOT NULL DEFAULT 0,
  attempt_history  jsonb NOT NULL DEFAULT '[]'::jsonb,
  next_attempt_at  timestamptz NOT NULL DEFAULT now(),
  last_error       text,
  last_status_code integer,
  dlq_reason       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  claimed_at       timestamptz,
  synced_at        timestamptz
);
CREATE INDEX IF NOT EXISTS eo_sync_due_idx
  ON public.email_octopus_contact_sync (next_attempt_at)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS eo_sync_status_idx
  ON public.email_octopus_contact_sync (status, updated_at DESC);
CREATE INDEX IF NOT EXISTS eo_sync_user_idx
  ON public.email_octopus_contact_sync (user_id);

GRANT ALL ON public.email_octopus_contact_sync TO service_role;
ALTER TABLE public.email_octopus_contact_sync ENABLE ROW LEVEL SECURITY;
-- Deny-all: only service_role (the worker) and the SECURITY DEFINER RPCs below touch this table.
-- Members never read or write it directly; they act only through set_my_marketing_subscription,
-- which is pinned to their own email via auth.uid().
CREATE POLICY "service manages eo sync" ON public.email_octopus_contact_sync
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 3. Member intent RPC (self-only). Reads the caller's OWN email from their profile via auth.uid(),
--    so a member can never act on another person's contact — there is no email parameter. Records the
--    local receipt and marks the desired state for the worker. Returns as soon as the intent is
--    durably recorded; it never calls EO (fail-open).
CREATE OR REPLACE FUNCTION public.set_my_marketing_subscription(
  p_subscribed boolean,
  p_source text DEFAULT 'profile'
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_email  text;
  v_first  text;
  v_status text := CASE WHEN p_subscribed THEN 'subscribed' ELSE 'unsubscribed' END;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING errcode = '28000';
  END IF;
  IF p_source NOT IN ('signup', 'profile') THEN
    p_source := 'profile';
  END IF;

  SELECT lower(email), first_name INTO v_email, v_first
  FROM public.profiles WHERE user_id = v_uid;
  IF v_email IS NULL OR v_email = '' THEN
    RAISE EXCEPTION 'no email on profile' USING errcode = 'P0002';
  END IF;

  -- Local receipt (proof only; not authoritative, never gates a send).
  UPDATE public.profiles
     SET marketing_opt_in_at = CASE WHEN p_subscribed THEN now() ELSE NULL END,
         marketing_opt_in_source = CASE WHEN p_subscribed THEN p_source ELSE marketing_opt_in_source END
   WHERE user_id = v_uid;

  -- Desired-state upsert: bump version and reset the worker's retry state so the latest intent wins,
  -- even if a prior attempt had gone to DLQ.
  INSERT INTO public.email_octopus_contact_sync AS s
    (email, user_id, desired_status, fields, version, synced_version, status,
     attempts, next_attempt_at, last_error, last_status_code, dlq_reason, updated_at)
  VALUES
    (v_email, v_uid, v_status,
     jsonb_strip_nulls(jsonb_build_object('first_name', v_first)),
     1, 0, 'pending', 0, now(), NULL, NULL, NULL, now())
  ON CONFLICT (email) DO UPDATE SET
     user_id          = EXCLUDED.user_id,
     desired_status   = EXCLUDED.desired_status,
     fields           = EXCLUDED.fields,
     version          = s.version + 1,
     status           = 'pending',
     attempts         = 0,
     next_attempt_at  = now(),
     last_error       = NULL,
     last_status_code = NULL,
     dlq_reason       = NULL,
     updated_at       = now();
END;
$$;
REVOKE ALL ON FUNCTION public.set_my_marketing_subscription(boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_my_marketing_subscription(boolean, text) TO authenticated;

-- 4. Worker claim (service-only): atomically claim due rows for syncing. Returns the claimed version
--    so settle can detect a newer intent that landed mid-flight.
CREATE OR REPLACE FUNCTION public.claim_eo_sync(p_max integer DEFAULT 25)
RETURNS TABLE (
  email text, user_id uuid, desired_status text, fields jsonb, version bigint, attempts integer
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
  WITH due AS (
    SELECT s.email
    FROM email_octopus_contact_sync s
    WHERE s.status = 'pending' AND s.next_attempt_at <= v_now
    ORDER BY s.next_attempt_at
    LIMIT p_max
    FOR UPDATE SKIP LOCKED
  ),
  claimed AS (
    UPDATE email_octopus_contact_sync s
    SET status = 'syncing', claimed_at = v_now, updated_at = v_now
    FROM due
    WHERE s.email = due.email
    RETURNING s.email, s.user_id, s.desired_status, s.fields, s.version, s.attempts
  )
  SELECT * FROM claimed;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_eo_sync(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_eo_sync(integer) TO service_role;

-- 5. Worker settle (service-only): record the result of one EO push. Optimistic concurrency on the
--    claimed version — if a newer member intent bumped version while the push was in flight, DO NOT
--    mark synced; return it to pending so the newer desired_status is pushed. Exponential backoff;
--    DLQ after 8 attempts or on a permanent failure. A stuck unsubscribe/delete is a compliance
--    signal (surfaced by get_eo_sync_health, paged by SRE).
CREATE OR REPLACE FUNCTION public.record_eo_sync_result(
  p_email text,
  p_version bigint,
  p_outcome text,               -- 'synced' | 'retry' | 'permanent_fail'
  p_status_code integer DEFAULT NULL,
  p_error text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row     public.email_octopus_contact_sync%ROWTYPE;
  v_now     timestamptz := now();
  v_attempt integer;
  v_next    timestamptz;
  c_max     constant integer := 8;
BEGIN
  SELECT * INTO v_row FROM public.email_octopus_contact_sync WHERE email = p_email FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- A newer intent arrived after this job was claimed → don't clobber it; make it due now.
  IF v_row.version <> p_version THEN
    UPDATE public.email_octopus_contact_sync
       SET status = 'pending', next_attempt_at = v_now, updated_at = v_now, claimed_at = NULL
     WHERE email = p_email AND status = 'syncing';
    RETURN;
  END IF;

  v_attempt := v_row.attempts + 1;

  IF p_outcome = 'synced' THEN
    UPDATE public.email_octopus_contact_sync
       SET status = 'synced', synced_version = p_version, synced_at = v_now, attempts = v_attempt,
           last_error = NULL, last_status_code = p_status_code, next_attempt_at = v_now,
           updated_at = v_now,
           attempt_history = attempt_history || jsonb_build_object('t', v_now, 'outcome', 'synced', 'code', p_status_code)
     WHERE email = p_email;
  ELSIF p_outcome = 'permanent_fail' OR v_attempt >= c_max THEN
    UPDATE public.email_octopus_contact_sync
       SET status = 'dlq',
           dlq_reason = COALESCE(p_error, CASE WHEN v_attempt >= c_max THEN 'max_attempts' ELSE 'permanent_fail' END),
           attempts = v_attempt, last_error = p_error, last_status_code = p_status_code,
           updated_at = v_now,
           attempt_history = attempt_history || jsonb_build_object('t', v_now, 'outcome', 'dlq', 'code', p_status_code, 'err', p_error)
     WHERE email = p_email;
  ELSE
    -- Exponential backoff: 30s * 2^(attempt-1), capped at 1 hour.
    v_next := v_now + LEAST(interval '1 hour', (interval '30 seconds') * power(2, v_attempt - 1));
    UPDATE public.email_octopus_contact_sync
       SET status = 'pending', next_attempt_at = v_next, attempts = v_attempt,
           last_error = p_error, last_status_code = p_status_code, updated_at = v_now,
           attempt_history = attempt_history || jsonb_build_object('t', v_now, 'outcome', 'retry', 'code', p_status_code, 'err', p_error, 'next', v_next)
     WHERE email = p_email;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.record_eo_sync_result(text, bigint, text, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_eo_sync_result(text, bigint, text, integer, text) TO service_role;

-- 6. SRE health snapshot (service-only): backlog + DLQ, with the unsubscribe/delete backlog broken
--    out — an un-synced opt-out means someone is still being marketed to after opting out, the paged
--    compliance signal (requirements §9 SRE).
CREATE OR REPLACE FUNCTION public.get_eo_sync_health()
RETURNS TABLE (
  pending integer, pending_optout integer, dlq integer, dlq_optout integer, oldest_pending_secs integer
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    count(*) FILTER (WHERE status = 'pending')::int,
    count(*) FILTER (WHERE status = 'pending' AND desired_status IN ('unsubscribed', 'deleted'))::int,
    count(*) FILTER (WHERE status = 'dlq')::int,
    count(*) FILTER (WHERE status = 'dlq' AND desired_status IN ('unsubscribed', 'deleted'))::int,
    COALESCE(EXTRACT(EPOCH FROM (now() - min(next_attempt_at) FILTER (WHERE status = 'pending')))::int, 0)
  FROM public.email_octopus_contact_sync;
$$;
REVOKE ALL ON FUNCTION public.get_eo_sync_health() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_eo_sync_health() TO service_role;
