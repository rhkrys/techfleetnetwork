-- Wave 1a · Reconciler v2-awareness — stop false-DLQ'ing v2 emails.
--
-- Root cause (found 2026-08-09): since the July cutover, email flows through the
-- v2 pipeline (`email_outbox`), whose terminal outcome is recorded in
-- `email_outbox.status` and NOT written back to the legacy `email_send_log`.
-- The reconciler only reads `email_send_log` + pgmq and is blind to
-- `email_outbox`, so it saw 327 already-sent v2 messages stuck at `pending`,
-- found them absent from pgmq, and wrongly dead-lettered them (the "330 lost"
-- that were actually sent). Now that the reconciler cron is live again it would
-- repeat this every 5 min for every future v2 email — false DLQs + false pages.
--
-- Fix: the reconciler owns the LEGACY lane only. Any message that has an
-- `email_outbox` row is v2 — managed by the dispatcher + its own DLQ/expiry — so
-- exclude it from stuck-detection. Companion migration 20260809130100 adds the
-- write-back trigger so v2 terminal states DO appear in `email_send_log` (System
-- Health truth); this migration is the belt to that suspenders.
--
-- Only change vs. 20260603205609: the `AND NOT EXISTS (… email_outbox …)` guard
-- in the stuck-id CTE. Everything else is byte-for-byte the prior body.

CREATE OR REPLACE FUNCTION public.reconcile_stuck_emails()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pgmq'
AS $function$
DECLARE
  v_reconciled_terminal int := 0;
  v_requeued int := 0;
  v_dlq_lost int := 0;
  v_left_in_queue int := 0;
  v_stuck_ids text[];
  v_in_queue text[];
  v_msg_id text;
  v_latest_row record;
  v_terminal_status text;
  v_terminal_ts timestamptz;
  v_reconcile_status text;
  v_result jsonb;
  v_queue_name text;
  v_payload jsonb;
  v_payload_queued_at timestamptz;
  v_ttl_minutes int;
BEGIN
  WITH latest AS (
    SELECT DISTINCT ON (message_id) message_id, status, created_at, template_name, recipient_email, metadata
    FROM public.email_send_log
    WHERE message_id IS NOT NULL
    ORDER BY message_id, created_at DESC
  )
  SELECT array_agg(message_id) INTO v_stuck_ids
  FROM latest
  WHERE status = 'pending'
    AND created_at < now() - interval '10 minutes'
    -- v2-awareness: a message with an email_outbox row is owned by the v2
    -- pipeline; the reconciler must not touch it (it is blind to that table).
    AND NOT EXISTS (
      SELECT 1 FROM public.email_outbox o WHERE o.message_id = latest.message_id
    );

  IF v_stuck_ids IS NULL OR array_length(v_stuck_ids, 1) IS NULL THEN
    v_result := jsonb_build_object(
      'reconciled_terminal', 0,
      'requeued', 0,
      'dlq_lost', 0,
      'marked_dlq', 0,
      'left_in_queue', 0,
      'checked', 0
    );
    INSERT INTO public.ops_events(kind, severity, payload)
    VALUES ('email_reconciler_run', 'info', v_result);
    RETURN v_result;
  END IF;

  SELECT array_agg(message_id) INTO v_in_queue
  FROM public.email_message_ids_in_queue(v_stuck_ids);

  v_left_in_queue := COALESCE(array_length(v_in_queue, 1), 0);

  FOR v_msg_id IN
    SELECT unnest(v_stuck_ids) EXCEPT SELECT unnest(COALESCE(v_in_queue, ARRAY[]::text[]))
  LOOP
    SELECT * INTO v_latest_row
    FROM public.email_send_log
    WHERE message_id = v_msg_id AND status = 'pending'
    ORDER BY created_at DESC
    LIMIT 1;

    SELECT status, created_at INTO v_terminal_status, v_terminal_ts
    FROM public.email_send_log
    WHERE message_id = v_msg_id
      AND status IN ('sent', 'failed', 'dlq', 'suppressed', 'bounced', 'complained',
                     'rate_limited', 'frequency_capped')
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_terminal_status IS NOT NULL THEN
      v_reconcile_status := CASE WHEN v_terminal_status = 'sent' THEN 'sent' ELSE 'dlq' END;

      INSERT INTO public.email_send_log(message_id, template_name, recipient_email, status, error_message)
      VALUES (
        v_msg_id,
        v_latest_row.template_name,
        v_latest_row.recipient_email,
        v_reconcile_status,
        format('Duplicate enqueue reconciled — original %s at %s', v_terminal_status, v_terminal_ts)
      );
      v_reconciled_terminal := v_reconciled_terminal + 1;
      CONTINUE;
    END IF;

    v_queue_name := COALESCE(
      v_latest_row.metadata->>'queue_name',
      CASE
        WHEN v_latest_row.template_name IN ('project-blast', 'fleety-coach-digest', 'announcement') THEN 'bulk_emails'
        ELSE 'transactional_emails'
      END
    );
    v_payload := v_latest_row.metadata->'queue_payload';
    v_payload_queued_at := COALESCE(NULLIF(v_payload->>'queued_at', '')::timestamptz, v_latest_row.created_at);

    SELECT CASE v_queue_name
      WHEN 'auth_emails' THEN COALESCE(auth_email_ttl_minutes, 15)
      WHEN 'bulk_emails' THEN COALESCE(bulk_email_ttl_minutes, 240)
      ELSE COALESCE(transactional_email_ttl_minutes, 60)
    END INTO v_ttl_minutes
    FROM public.email_send_state
    WHERE id = 1;
    v_ttl_minutes := COALESCE(v_ttl_minutes, 60);

    IF v_payload IS NOT NULL
       AND jsonb_typeof(v_payload) = 'object'
       AND v_queue_name IN ('auth_emails', 'transactional_emails', 'bulk_emails')
       AND v_payload_queued_at >= now() - make_interval(mins => v_ttl_minutes)
    THEN
      v_payload := jsonb_set(v_payload, '{queued_at}', to_jsonb(now()), true);
      v_payload := jsonb_set(
        v_payload,
        '{metadata}',
        COALESCE(v_payload->'metadata', '{}'::jsonb) || jsonb_build_object(
          'requeued_by', 'reconcile_stuck_emails',
          'requeued_at', now()
        ),
        true
      );

      PERFORM public.enqueue_email(v_queue_name, v_payload);
      INSERT INTO public.email_send_log(message_id, template_name, recipient_email, status, error_message, metadata)
      VALUES (
        v_msg_id,
        v_latest_row.template_name,
        v_latest_row.recipient_email,
        'pending',
        'Requeued by stuck email reconciler',
        COALESCE(v_latest_row.metadata, '{}'::jsonb) || jsonb_build_object(
          'queue_name', v_queue_name,
          'queue_payload', v_payload,
          'requeued_by', 'reconcile_stuck_emails',
          'requeued_at', now()
        )
      );
      v_requeued := v_requeued + 1;
    ELSE
      INSERT INTO public.email_send_log(message_id, template_name, recipient_email, status, error_message)
      VALUES (
        v_msg_id,
        v_latest_row.template_name,
        v_latest_row.recipient_email,
        'dlq',
        'Lost before send — reconciler timeout'
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
        RAISE WARNING 'agent_fix_queue insert failed in reconciler: %', SQLERRM;
      END;

      v_dlq_lost := v_dlq_lost + 1;
    END IF;
  END LOOP;

  v_result := jsonb_build_object(
    'reconciled_terminal', v_reconciled_terminal,
    'requeued', v_requeued,
    'dlq_lost', v_dlq_lost,
    'marked_dlq', v_dlq_lost,
    'left_in_queue', v_left_in_queue,
    'checked', COALESCE(array_length(v_stuck_ids, 1), 0)
  );

  INSERT INTO public.ops_events(kind, severity, payload)
  VALUES (
    'email_reconciler_run',
    CASE WHEN v_dlq_lost > 0 THEN 'error'
         WHEN v_requeued > 0 OR v_reconciled_terminal > 0 THEN 'warn'
         ELSE 'info' END,
    v_result
  );

  RETURN v_result;
END;
$function$;
