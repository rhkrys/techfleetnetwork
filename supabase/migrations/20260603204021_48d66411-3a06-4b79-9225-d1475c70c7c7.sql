-- Update reconciler to emit an ops_events row per run (Layer 5 visibility).
CREATE OR REPLACE FUNCTION public.reconcile_stuck_emails()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pgmq'
AS $function$
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
  v_result jsonb;
BEGIN
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
    v_result := jsonb_build_object(
      'reconciled_terminal', 0, 'marked_dlq', 0,
      'left_in_queue', 0, 'checked', 0
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
        RAISE WARNING 'agent_fix_queue insert failed in reconciler: %', SQLERRM;
      END;

      v_marked_dlq := v_marked_dlq + 1;
    END IF;
  END LOOP;

  v_result := jsonb_build_object(
    'reconciled_terminal', v_reconciled_terminal,
    'marked_dlq', v_marked_dlq,
    'left_in_queue', v_left_in_queue,
    'checked', COALESCE(array_length(v_stuck_ids, 1), 0)
  );

  INSERT INTO public.ops_events(kind, severity, payload)
  VALUES (
    'email_reconciler_run',
    CASE WHEN v_marked_dlq > 0 THEN 'error'
         WHEN v_reconciled_terminal > 0 THEN 'warn'
         ELSE 'info' END,
    v_result
  );

  RETURN v_result;
END;
$function$;

-- Read-side helper for System Health "Stuck pending" card.
CREATE OR REPLACE FUNCTION public.get_email_reconciler_status()
RETURNS jsonb
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
  ),
  stuck AS (
    SELECT count(*)::int AS n
    FROM latest
    WHERE status = 'pending' AND created_at < now() - interval '10 minutes'
  ),
  last_run AS (
    SELECT occurred_at, payload, severity
    FROM public.ops_events
    WHERE kind = 'email_reconciler_run'
    ORDER BY occurred_at DESC
    LIMIT 1
  )
  SELECT jsonb_build_object(
    'stuck_pending', (SELECT n FROM stuck),
    'last_run_at',   (SELECT occurred_at FROM last_run),
    'last_run',      (SELECT payload FROM last_run),
    'last_severity', (SELECT severity FROM last_run)
  );
$$;

REVOKE ALL ON FUNCTION public.get_email_reconciler_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_email_reconciler_status() TO authenticated, service_role;