-- ============================================================================
-- Email DLQ replay infrastructure (Part 1.3 of refactor plan)
-- ----------------------------------------------------------------------------
-- Provides:
--   * pgmq archive read/delete RPC wrappers (callable by service_role only)
--   * notify_admins_email_dlq_escalation: persists admin notifications after
--     3 failed replays so silent DLQ rot becomes visible.
--   * 5-minute pg_cron job that pokes the replay-email-dlq edge function.
-- ============================================================================

-- ---------- pgmq archive read wrapper -------------------------------------
CREATE OR REPLACE FUNCTION public.pgmq_read_archive(queue_name text, qty integer)
RETURNS TABLE (
  msg_id      bigint,
  read_ct     integer,
  enqueued_at timestamptz,
  vt          timestamptz,
  message     jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pgmq
AS $$
DECLARE
  sql text;
BEGIN
  IF queue_name !~ '^[a-z_][a-z0-9_]*$' THEN
    RAISE EXCEPTION 'invalid queue name: %', queue_name;
  END IF;
  sql := format(
    'SELECT msg_id, read_ct, enqueued_at, vt, message
       FROM pgmq.a_%I
       ORDER BY enqueued_at ASC
       LIMIT %L',
    queue_name, qty
  );
  RETURN QUERY EXECUTE sql;
EXCEPTION WHEN undefined_table THEN
  -- Archive table not present (queue may not have one yet) — return empty.
  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.pgmq_read_archive(text, integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pgmq_read_archive(text, integer) TO service_role;

-- ---------- pgmq archive delete wrapper -----------------------------------
CREATE OR REPLACE FUNCTION public.pgmq_archive_delete(queue_name text, msg_id bigint)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pgmq
AS $$
DECLARE
  sql text;
  removed integer;
BEGIN
  IF queue_name !~ '^[a-z_][a-z0-9_]*$' THEN
    RAISE EXCEPTION 'invalid queue name: %', queue_name;
  END IF;
  sql := format('DELETE FROM pgmq.a_%I WHERE msg_id = %L', queue_name, msg_id);
  EXECUTE sql;
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed > 0;
EXCEPTION WHEN undefined_table THEN
  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.pgmq_archive_delete(text, bigint) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pgmq_archive_delete(text, bigint) TO service_role;

-- ---------- Admin escalation after MAX_REPLAY_GENERATION ------------------
CREATE OR REPLACE FUNCTION public.notify_admins_email_dlq_escalation(
  p_lane       text,
  p_template   text,
  p_recipient  text,
  p_payload    jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  admin_id uuid;
  body text;
BEGIN
  body := format(
    'Email permanently dropped after 3 replays. Lane: %s. Template: %s. Recipient: %s.',
    coalesce(p_lane, 'unknown'),
    coalesce(p_template, 'unknown'),
    coalesce(p_recipient, 'unknown')
  );

  FOR admin_id IN
    SELECT user_id FROM public.user_roles WHERE role = 'admin'
  LOOP
    INSERT INTO public.notifications (user_id, notification_type, title, body, link, metadata)
    VALUES (
      admin_id,
      'email_dlq_escalation',
      'Email failed permanently',
      body,
      '/admin/system-health?tab=email',
      jsonb_build_object(
        'lane', p_lane,
        'template', p_template,
        'recipient', p_recipient,
        'payload_preview', p_payload,
        'severity', 'error'
      )
    );
  END LOOP;

  -- Mirror to audit_log as a severity:error event so triage can see it too.
  INSERT INTO public.audit_log (event_type, entity_type, entity_id, changed_fields, metadata)
  VALUES (
    'email_dlq_escalation',
    'email',
    coalesce(p_recipient, 'unknown'),
    ARRAY['severity:error']::text[],
    jsonb_build_object(
      'lane', p_lane,
      'template', p_template,
      'recipient', p_recipient
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.notify_admins_email_dlq_escalation(text, text, text, jsonb) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_admins_email_dlq_escalation(text, text, text, jsonb) TO service_role;

-- ---------- 5-minute cron poke of the replay edge function ---------------
DO $$
DECLARE
  v_url    text;
  v_key    text;
  v_jobid  bigint;
BEGIN
  -- URL of the edge function
  v_url := 'https://iqsjhrhsjlgjiaedzmtz.supabase.co/functions/v1/replay-email-dlq';

  -- Look up the service-role bearer using the same COALESCE fallback as
  -- process-email-queue (see memory: Email Queue Cron Bulk + Keys).
  BEGIN
    SELECT decrypted_secret INTO v_key
      FROM vault.decrypted_secrets
     WHERE name IN (
        'service_role_key',
        'SERVICE_ROLE_KEY',
        'email_queue_service_role_key',
        'EMAIL_QUEUE_SERVICE_ROLE_KEY'
     )
     ORDER BY CASE name
        WHEN 'service_role_key' THEN 1
        WHEN 'SERVICE_ROLE_KEY' THEN 2
        WHEN 'email_queue_service_role_key' THEN 3
        WHEN 'EMAIL_QUEUE_SERVICE_ROLE_KEY' THEN 4
     END
     LIMIT 1;
  EXCEPTION WHEN insufficient_privilege OR undefined_table THEN
    v_key := NULL;
  END;

  IF v_key IS NULL THEN
    RAISE NOTICE 'replay-email-dlq cron skipped: no service-role key in vault';
    RETURN;
  END IF;

  -- Unschedule any existing version then reschedule fresh.
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'replay-email-dlq-every-5min';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;

  PERFORM cron.schedule(
    'replay-email-dlq-every-5min',
    '*/5 * * * *',
    format(
      $cron$
      SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer %s'
        ),
        body := jsonb_build_object('source', 'cron', 'at', now()::text)
      );
      $cron$,
      v_url,
      v_key
    )
  );
END
$$;