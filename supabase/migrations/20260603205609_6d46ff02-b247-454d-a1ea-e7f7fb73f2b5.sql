-- EMAIL-RECONCILE completion: allow terminal sent reconciliation rows,
-- add requeue counters, and register BDD scenarios.

DROP INDEX IF EXISTS public.idx_email_send_log_message_sent_unique;
CREATE UNIQUE INDEX IF NOT EXISTS idx_email_send_log_message_sent_provider_unique
  ON public.email_send_log(message_id)
  WHERE status = 'sent' AND error_message IS NULL;

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
    AND created_at < now() - interval '10 minutes';

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

INSERT INTO public.bdd_scenarios (
  feature_area_number,
  feature_area,
  scenario_id,
  title,
  gherkin,
  status,
  test_type,
  test_file,
  notes
) VALUES
(80, 'Email reconciliation', 'EMAIL-RECONCILE-001', 'Duplicate enqueue is stopped before queue insert',
 E'Feature: Email reconciliation\n  Scenario: Duplicate app email submit repeats an existing message id\n    Given an email_send_log row already exists for message id "msg-1" with status "sent"\n    When the app email enqueue helper receives the same message id again\n    Then [UI] the caller receives success with deduped=true and no visible resend prompt\n    And [DB] no new pending row and no new pgmq queue row are created for "msg-1"\n    And [Code] queueTransactionalEmail returns before insertEmailLog and enqueue_email',
 'implemented', 'unit', 'src/test/smoke/email-reconciliation.smoke.test.ts', 'Layer 1 server-side dedup guard.'),
(80, 'Email reconciliation', 'EMAIL-RECONCILE-002', 'Worker writes terminal row when duplicate queue item is skipped',
 E'Feature: Email reconciliation\n  Scenario: Worker sees a duplicate queued message after original delivery\n    Given email_send_log has an earlier sent row and a later duplicate pending row for the same message id\n    When process-email-queue detects the message was already sent\n    Then [UI] the email dashboard latest-row view shows the email as sent, not pending\n    And [DB] a new append-only sent row is added with a duplicate-reconciled reason before the queue row is deleted\n    And [Code] process-email-queue writes the terminal row inside the alreadySent branch',
 'implemented', 'unit', 'src/test/smoke/email-reconciliation.smoke.test.ts', 'Layer 2 worker dup-skip terminal row.'),
(80, 'Email reconciliation', 'EMAIL-RECONCILE-003', 'Reconciler resolves stuck pending with earlier terminal reality',
 E'Feature: Email reconciliation\n  Scenario: Latest row is old pending but an earlier delivered row exists\n    Given latest email_send_log status per message id is pending older than 10 minutes\n    And the same message id has an earlier sent row and no pgmq queue row\n    When reconcile_stuck_emails runs\n    Then [UI] System Health stuck pending count decreases on the next refresh\n    And [DB] a terminal sent reconciliation row is appended for that message id\n    And [Code] the reconciler increments reconciled_terminal in ops_events',
 'implemented', 'unit', 'src/test/smoke/email-reconciliation.smoke.test.ts', 'Layer 3 terminal reconciliation.'),
(80, 'Email reconciliation', 'EMAIL-RECONCILE-004', 'Reconciler leaves active queue work alone',
 E'Feature: Email reconciliation\n  Scenario: Old pending row still has a live queue message\n    Given latest email_send_log status per message id is pending older than 10 minutes\n    And pgmq still contains a row with that message id\n    When reconcile_stuck_emails runs\n    Then [UI] the stuck pending card may remain amber until the worker finishes\n    And [DB] no terminal or dlq row is appended for that message id\n    And [Code] the reconciler increments left_in_queue only',
 'implemented', 'unit', 'src/test/smoke/email-reconciliation.smoke.test.ts', 'Protects normal retry engine behavior.'),
(80, 'Email reconciliation', 'EMAIL-RECONCILE-005', 'Reconciler requeues recoverable lost pending emails',
 E'Feature: Email reconciliation\n  Scenario: Pending email vanished from pgmq but is still inside its TTL\n    Given latest email_send_log status per message id is pending older than 10 minutes\n    And metadata contains the original queue payload and the queued_at timestamp is inside TTL\n    When reconcile_stuck_emails runs\n    Then [UI] the stuck pending card clears after the worker sends or retries the requeued email\n    And [DB] the original payload is reinserted into the correct queue and a fresh pending row is appended\n    And [Code] the reconciler increments requeued in ops_events',
 'implemented', 'unit', 'src/test/smoke/email-reconciliation.smoke.test.ts', 'Self-heals true lost queue entries when recoverable.'),
(80, 'Email reconciliation', 'EMAIL-RECONCILE-006', 'Reconciler escalates unrecoverable lost emails',
 E'Feature: Email reconciliation\n  Scenario: Pending email vanished and cannot be safely requeued\n    Given latest email_send_log status per message id is pending older than 10 minutes\n    And there is no terminal row, no pgmq row, and no recoverable payload inside TTL\n    When reconcile_stuck_emails runs\n    Then [UI] System Health shows the run with dlq_lost greater than zero\n    And [DB] a dlq row is appended and agent_fix_queue receives a severity error item\n    And [Code] the reconciler emits an email_reconciler_run ops_event with severity error',
 'implemented', 'unit', 'src/test/smoke/email-reconciliation.smoke.test.ts', 'Escalates unrecoverable losses without human polling.')
ON CONFLICT (scenario_id) DO UPDATE SET
  title = EXCLUDED.title,
  gherkin = EXCLUDED.gherkin,
  status = EXCLUDED.status,
  test_type = EXCLUDED.test_type,
  test_file = EXCLUDED.test_file,
  notes = EXCLUDED.notes,
  updated_at = now();