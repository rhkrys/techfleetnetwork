-- EMAIL-RECONCILE: self-healing reconciler for stuck "pending" email_send_log rows.

-- 1. Extend the CHECK constraint to allow 'reconciled' (terminal, used by
--    Layer 2 worker dup-skip and the reconciler when an earlier terminal row
--    exists). 'rate_limited' and 'frequency_capped' are ALSO added because
--    the worker already inserts them (constraint was silently rejecting).
ALTER TABLE public.email_send_log DROP CONSTRAINT IF EXISTS email_send_log_status_check;
ALTER TABLE public.email_send_log ADD CONSTRAINT email_send_log_status_check
  CHECK (status = ANY (ARRAY[
    'pending', 'sent', 'suppressed', 'failed', 'bounced', 'complained',
    'dlq', 'reconciled', 'rate_limited', 'frequency_capped'
  ]));

-- 2. Helper: which message_ids are still pending delivery in any pgmq queue?
CREATE OR REPLACE FUNCTION public.email_message_ids_in_queue(p_message_ids text[])
RETURNS TABLE(message_id text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pgmq
AS $$
BEGIN
  RETURN QUERY
  SELECT DISTINCT (message->>'message_id')::text
  FROM pgmq.q_transactional_emails
  WHERE (message->>'message_id') = ANY(p_message_ids)
  UNION
  SELECT DISTINCT (message->>'message_id')::text
  FROM pgmq.q_auth_emails
  WHERE (message->>'message_id') = ANY(p_message_ids)
  UNION
  SELECT DISTINCT (message->>'message_id')::text
  FROM pgmq.q_bulk_emails
  WHERE (message->>'message_id') = ANY(p_message_ids);
END;
$$;

REVOKE ALL ON FUNCTION public.email_message_ids_in_queue(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_message_ids_in_queue(text[]) TO service_role;

-- 3. Reconciler: idempotent, safe to run on any cadence.
CREATE OR REPLACE FUNCTION public.reconcile_stuck_emails()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pgmq
AS $$
DECLARE
  v_reconciled_terminal int := 0;
  v_marked_dlq int := 0;
  v_left_in_queue int := 0;
  v_stuck_ids text[];
  v_in_queue text[];
  v_msg_id text;
  v_latest_row record;
  v_terminal_status text;
  v_terminal_ts timestamptz;
BEGIN
  -- Find every message_id whose LATEST row is 'pending' and >10 min old.
  WITH latest AS (
    SELECT DISTINCT ON (message_id) message_id, status, created_at, template_name, recipient_email
    FROM public.email_send_log
    WHERE message_id IS NOT NULL
    ORDER BY message_id, created_at DESC
  )
  SELECT array_agg(message_id) INTO v_stuck_ids
  FROM latest
  WHERE status = 'pending'
    AND created_at < now() - interval '10 minutes';

  IF v_stuck_ids IS NULL OR array_length(v_stuck_ids, 1) IS NULL THEN
    RETURN jsonb_build_object(
      'reconciled_terminal', 0, 'marked_dlq', 0,
      'left_in_queue', 0, 'checked', 0
    );
  END IF;

  SELECT array_agg(message_id) INTO v_in_queue
  FROM public.email_message_ids_in_queue(v_stuck_ids);

  v_left_in_queue := COALESCE(array_length(v_in_queue, 1), 0);

  FOR v_msg_id IN
    SELECT unnest(v_stuck_ids) EXCEPT SELECT unnest(COALESCE(v_in_queue, ARRAY[]::text[]))
  LOOP
    -- Any earlier terminal row for this message_id?
    SELECT status, created_at INTO v_terminal_status, v_terminal_ts
    FROM public.email_send_log
    WHERE message_id = v_msg_id
      AND status IN ('sent', 'failed', 'dlq', 'suppressed', 'bounced', 'complained',
                     'rate_limited', 'frequency_capped', 'reconciled')
    ORDER BY created_at DESC
    LIMIT 1;

    SELECT * INTO v_latest_row
    FROM public.email_send_log
    WHERE message_id = v_msg_id AND status = 'pending'
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_terminal_status IS NOT NULL THEN
      -- Earlier terminal row exists → write a 'reconciled' row so the
      -- latest-row-per-message_id view becomes terminal. Cannot reuse
      -- 'sent' because of partial unique index on (message_id) WHERE sent.
      INSERT INTO public.email_send_log(message_id, template_name, recipient_email, status, error_message)
      VALUES (
        v_msg_id,
        v_latest_row.template_name,
        v_latest_row.recipient_email,
        'reconciled',
        format('Reconciled — original %s at %s', v_terminal_status, v_terminal_ts)
      );
      v_reconciled_terminal := v_reconciled_terminal + 1;
    ELSE
      -- Truly orphaned: no terminal row, no queue entry. Mark dlq + push
      -- severity=error to triage.
      INSERT INTO public.email_send_log(message_id, template_name, recipient_email, status, error_message)
      VALUES (
        v_msg_id,
        v_latest_row.template_name,
        v_latest_row.recipient_email,
        'dlq',
        'Lost before send — reconciler timeout (no queue entry, no terminal row)'
      );

      BEGIN
        INSERT INTO public.agent_fix_queue(fingerprint, event_type, source, severity, error_message)
        VALUES (
          format('email_queue.lost_orphan.%s', to_char(date_trunc('hour', now()), 'YYYY-MM-DD"T"HH24')),
          'email_dlq',
          'reconcile_stuck_emails',
          'error',
          format('Email lost before send: template=%s recipient=%s message_id=%s',
                 v_latest_row.template_name, v_latest_row.recipient_email, v_msg_id)
        )
        ON CONFLICT (fingerprint) DO UPDATE
          SET error_message = EXCLUDED.error_message;
      EXCEPTION WHEN OTHERS THEN
        -- agent_fix_queue insert failure must NEVER block reconciliation.
        RAISE WARNING 'agent_fix_queue insert failed in reconciler: %', SQLERRM;
      END;

      v_marked_dlq := v_marked_dlq + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'reconciled_terminal', v_reconciled_terminal,
    'marked_dlq', v_marked_dlq,
    'left_in_queue', v_left_in_queue,
    'checked', COALESCE(array_length(v_stuck_ids, 1), 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_stuck_emails() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_stuck_emails() TO service_role;

-- 4. Stuck pending count (for System Health card).
CREATE OR REPLACE FUNCTION public.get_stuck_pending_email_count(p_age_minutes int DEFAULT 10)
RETURNS int
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH latest AS (
    SELECT DISTINCT ON (message_id) message_id, status, created_at
    FROM public.email_send_log
    WHERE message_id IS NOT NULL
    ORDER BY message_id, created_at DESC
  )
  SELECT COUNT(*)::int FROM latest
  WHERE status = 'pending'
    AND created_at < now() - (p_age_minutes || ' minutes')::interval;
$$;

GRANT EXECUTE ON FUNCTION public.get_stuck_pending_email_count(int) TO authenticated, service_role;

-- 5. One-shot backfill of the 4 currently-visible stuck pendings.
DO $$
DECLARE
  v_result jsonb;
BEGIN
  v_result := public.reconcile_stuck_emails();
  RAISE NOTICE 'Backfill reconcile result: %', v_result;
END $$;

-- 6. pg_cron: run reconciler every 5 minutes.
DO $$
DECLARE
  v_existing_jobid bigint;
BEGIN
  SELECT jobid INTO v_existing_jobid FROM cron.job WHERE jobname = 'reconcile-stuck-emails';
  IF v_existing_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_existing_jobid);
  END IF;

  PERFORM cron.schedule(
    'reconcile-stuck-emails',
    '*/5 * * * *',
    $cron$SELECT public.reconcile_stuck_emails();$cron$
  );
END $$;