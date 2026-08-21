-- PR 2 (email rearchitecture): move the two dead DB-trigger emails onto the v2 outbox.
--
-- Context (verified 2026-08-19): `notify_feedback_submitted` (feedback_alert) and
-- `process_notification_fanout_chunk` (project_opening_alert) enqueued via the raw
-- `enqueue_email(queue_name, payload)` -> `pgmq.send` path, whose consumer (process-email-queue)
-- was RETIRED at the July v2 cutover (see supabase/functions/_shared/transactional-email.ts:592).
-- Both have therefore been delivering NOTHING since the cutover.
--
-- Fix: call `enqueue_email_v2` directly (email_outbox -> email-dispatcher -> Resend). Each function
-- is reproduced verbatim from 20260522034021 with ONLY the enqueue call reshaped:
--   raw:  enqueue_email('transactional_emails', jsonb{to,subject,html,text,label,message_id,...})
--   v2:   enqueue_email_v2(lane, template, recipient, subject, payload, idempotency_key, message_id)
-- The dispatcher reads payload.html/text + the discrete subject column.
--
-- Lanes: feedback_alert -> 'transactional' (low-volume ops alert to admins);
--        project_opening_alert -> 'bulk' (broadcast fanout — the bulk lane isolates a large send
--        from the shared transactional/auth token bucket; matches the email tier registry).
--
-- NOT changed here (deferred, by design):
--   • the old-domain (techfleetnetwork.lovable.app) links inside the templates — PR 4 rebuilds the
--     unsubscribe links wholesale (RFC 8058), so they are left byte-for-byte unchanged for now.
--   • the notify_announcements gate on both — removed/re-gated in PRs 3 and 5.
-- This migration also reshapes public.reconcile_stuck_emails() (its one raw re-enqueue at line
-- 147, verbatim otherwise from 20260809130050). The edge DLQ-replay callers + the announcement
-- legacy fallback are reshaped in the TypeScript changes of the same PR.

CREATE OR REPLACE FUNCTION public.notify_feedback_submitted()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_admin record;
  v_body text;
  v_submitter_name text;
  v_message_id text;
  v_plain_text text;
  v_unsub_token text;
BEGIN
  BEGIN
    SELECT COALESCE(NULLIF(display_name, ''), NULLIF(first_name, ''), 'A member')
      INTO v_submitter_name
      FROM public.profiles WHERE user_id = NEW.user_id;

    v_body := '<p><strong>From:</strong> ' || COALESCE(v_submitter_name, 'Unknown') ||
              ' (' || NEW.user_email || ')</p>' ||
              '<p><strong>Area:</strong> ' || NEW.system_area || '</p>' ||
              '<p>' || LEFT(NEW.message, 200) ||
              CASE WHEN LENGTH(NEW.message) > 200 THEN '…' ELSE '' END || '</p>';

    v_plain_text := 'From: ' || COALESCE(v_submitter_name, 'Unknown') ||
                    ' (' || NEW.user_email || ')' || E'\n' ||
                    'Area: ' || NEW.system_area || E'\n\n' ||
                    LEFT(NEW.message, 300) ||
                    CASE WHEN LENGTH(NEW.message) > 300 THEN '…' ELSE '' END;

    FOR v_admin IN
      SELECT p.user_id, p.email, p.notify_announcements, p.first_name
      FROM public.user_roles ur
      JOIN public.profiles p ON p.user_id = ur.user_id
      WHERE ur.role = 'admin'
    LOOP
      BEGIN
        INSERT INTO public.notifications (user_id, title, body_html, notification_type, link_url)
        VALUES (
          v_admin.user_id,
          'New Feedback: ' || NEW.system_area,
          v_body,
          'feedback',
          '/feedback'
        );
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'notify_feedback: notification insert failed for admin %: %', v_admin.user_id, SQLERRM;
      END;

      IF v_admin.notify_announcements = true AND v_admin.email != '' THEN
        BEGIN
          v_message_id := 'feedback-' || NEW.id || '-' || v_admin.user_id;

          v_unsub_token := encode(extensions.gen_random_bytes(32), 'hex');
          INSERT INTO public.email_unsubscribe_tokens (email, token)
          VALUES (v_admin.email, v_unsub_token);

          PERFORM public.enqueue_email_v2(
            'transactional',
            'feedback_alert',
            v_admin.email,
            'New Feedback Submitted: ' || NEW.system_area,
            jsonb_build_object(
              'html', '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body style="font-family: -apple-system, BlinkMacSystemFont, ''Segoe UI'', Roboto, sans-serif; margin: 0; padding: 0; background-color: #f4f4f5;"><div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;"><div style="background: #ffffff; border-radius: 8px; padding: 32px; border: 1px solid #e4e4e7;"><div style="text-align: center; margin-bottom: 24px;"><h1 style="font-size: 14px; font-weight: 600; color: #71717a; text-transform: uppercase; letter-spacing: 0.05em; margin: 0;">Tech Fleet Feedback</h1></div><h2 style="font-size: 22px; font-weight: 700; color: #18181b; margin: 0 0 16px 0;">New Feedback Submitted</h2><p style="font-size: 15px; line-height: 1.6; color: #3f3f46;">Hi ' || COALESCE(v_admin.first_name, 'Admin') || ',</p><p style="font-size: 15px; line-height: 1.6; color: #3f3f46;">A member has submitted feedback about <strong>' || NEW.system_area || '</strong>.</p><div style="background: #f4f4f5; border-radius: 6px; padding: 16px; margin: 16px 0;"><p style="font-size: 13px; font-weight: 600; color: #71717a; margin: 0 0 4px;">From: ' || COALESCE(v_submitter_name, 'Unknown') || ' (' || NEW.user_email || ')</p><p style="font-size: 14px; line-height: 1.5; color: #3f3f46; margin: 8px 0 0;">' || LEFT(NEW.message, 300) || CASE WHEN LENGTH(NEW.message) > 300 THEN '…' ELSE '' END || '</p></div><div style="text-align: center; margin: 24px 0;"><a href="https://techfleetnetwork.lovable.app/feedback" style="display: inline-block; background-color: #18181b; color: #ffffff; font-size: 14px; font-weight: 600; padding: 12px 24px; border-radius: 6px; text-decoration: none;">View All Feedback</a></div><hr style="border: none; border-top: 1px solid #e4e4e7; margin: 24px 0;" /><p style="font-size: 12px; color: #a1a1aa; text-align: center; margin: 0;">You received this because you are an admin on Tech Fleet Network.<br/>To unsubscribe, <a href="https://techfleetnetwork.lovable.app/profile/edit?tab=preferences" style="color: #3b82f6; text-decoration: underline;">update your notification preferences</a> in your profile settings.</p></div></div></body></html>',
              'text', 'Hi ' || COALESCE(v_admin.first_name, 'Admin') || E',\n\nNew feedback submitted about ' || NEW.system_area || E'.\n\n' || v_plain_text || E'\n\nView all feedback: https://techfleetnetwork.lovable.app/feedback',
              'from', 'Tech Fleet <onboarding@techfleet.org>',
              'sender_domain', 'notify.techfleet.org',
              'purpose', 'transactional',
              'label', 'feedback_alert',
              'unsubscribe_token', v_unsub_token,
              'queued_at', now()::text
            ),
            v_message_id,
            v_message_id
          );
        EXCEPTION WHEN OTHERS THEN
          RAISE WARNING 'notify_feedback: email enqueue failed for %: %', v_admin.email, SQLERRM;
        END;
      END IF;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notify_feedback_submitted failed entirely: %', SQLERRM;
  END;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.process_notification_fanout_chunk(p_job_id uuid, p_chunk_size integer DEFAULT 500)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_job              public.notification_fanout_jobs%ROWTYPE;
  v_payload          jsonb;
  v_project_id       uuid;
  v_client_name      text;
  v_friendly_name    text;
  v_project_label    text;
  v_project_type     text;
  v_phase            text;
  v_new_status_label text;
  v_old_status_label text;
  v_is_apply_now     boolean;
  v_title            text;
  v_body             text;
  v_plain_text       text;
  v_user             record;
  v_message_id       text;
  v_unsub_token      text;
  v_processed        integer := 0;
  v_total_after      integer;
  v_remaining        integer;
BEGIN
  SELECT * INTO v_job FROM public.notification_fanout_jobs WHERE id = p_job_id FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('processed',0,'remaining',0,'done',true,'job_id',p_job_id,'skipped',true);
  END IF;
  IF v_job.status = 'done' THEN
    RETURN jsonb_build_object('processed',0,'remaining',0,'done',true,'job_id',p_job_id);
  END IF;

  v_payload      := v_job.payload;
  v_project_id   := (v_payload->>'project_id')::uuid;
  v_is_apply_now := COALESCE((v_payload->>'is_apply_now')::boolean, false);

  SELECT name INTO v_client_name FROM public.clients WHERE id = (v_payload->>'client_id')::uuid;
  v_friendly_name    := COALESCE(NULLIF(v_payload->>'friendly_name', ''), '');
  v_project_label    := COALESCE(NULLIF(v_client_name, ''), 'Unknown') ||
                        CASE WHEN v_friendly_name <> '' THEN ' — ' || v_friendly_name ELSE '' END;
  v_project_type     := REPLACE(INITCAP(REPLACE(v_payload->>'project_type', '_', ' ')), '_', ' ');
  v_phase            := REPLACE(INITCAP(REPLACE(v_payload->>'phase', '_', ' ')), '_', ' ');
  v_new_status_label := REPLACE(INITCAP(REPLACE(v_payload->>'new_status', '_', ' ')), '_', ' ');
  v_old_status_label := CASE WHEN v_payload->>'old_status' IS NOT NULL
                             THEN REPLACE(INITCAP(REPLACE(v_payload->>'old_status', '_', ' ')), '_', ' ') END;

  IF v_is_apply_now THEN
    v_title      := 'ALERT! New Project Training Opportunity';
    v_body       := '<p><strong>Project:</strong> ' || v_project_label ||
                    '</p><p><strong>Project Type:</strong> ' || v_project_type ||
                    '</p><p><strong>Phase:</strong> ' || v_phase || '</p>';
    v_plain_text := 'Project: ' || v_project_label || E'\n' ||
                    'Project Type: ' || v_project_type || E'\n' || 'Phase: ' || v_phase;
  ELSE
    v_title      := 'Project Status Update: ' || v_project_label;
    v_body       := '<p><strong>Project:</strong> ' || v_project_label ||
                    '</p><p><strong>New Status:</strong> ' || v_new_status_label ||
                    CASE WHEN v_old_status_label IS NOT NULL
                         THEN '</p><p><strong>Previous Status:</strong> ' || v_old_status_label ELSE '' END ||
                    '</p><p><strong>Phase:</strong> ' || v_phase || '</p>';
    v_plain_text := 'Project: ' || v_project_label || E'\n' ||
                    'New Status: ' || v_new_status_label || E'\n' ||
                    COALESCE('Previous Status: ' || v_old_status_label || E'\n', '') ||
                    'Phase: ' || v_phase;
  END IF;

  UPDATE public.notification_fanout_jobs
     SET status='running', attempts=attempts+1, started_at=COALESCE(started_at, now())
   WHERE id = p_job_id;

  FOR v_user IN
    SELECT p.user_id, p.email, p.notify_announcements, p.first_name
    FROM public.profiles p
    WHERE p.notify_training_opportunities = true
      AND 'Train on project teams' = ANY(p.interests)
    ORDER BY p.user_id
    OFFSET v_job.next_offset
    LIMIT p_chunk_size
  LOOP
    BEGIN
      INSERT INTO public.notifications (user_id, title, body_html, notification_type, link_url)
      VALUES (v_user.user_id, v_title, v_body, 'project_opening', '/project-openings/' || v_project_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'fanout: notification insert failed for %: %', v_user.user_id, SQLERRM;
    END;

    IF v_user.notify_announcements = true AND v_user.email <> '' THEN
      BEGIN
        v_message_id := 'project-status-' || v_project_id || '-' || (v_payload->>'new_status') || '-' || v_user.user_id;

        INSERT INTO public.email_unsubscribe_tokens (email, token)
        VALUES (v_user.email, encode(extensions.gen_random_bytes(32), 'hex'))
        ON CONFLICT (email) DO NOTHING;
        SELECT token INTO v_unsub_token FROM public.email_unsubscribe_tokens WHERE email = v_user.email;

        PERFORM public.enqueue_email_v2(
          'bulk',
          'project_opening_alert',
          v_user.email,
          v_title,
          jsonb_build_object(
            'html', '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; margin: 0; padding: 0; background-color: #f4f4f5;"><div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;"><div style="background: #ffffff; border-radius: 8px; padding: 32px; border: 1px solid #e4e4e7;"><h2 style="font-size: 22px; font-weight: 700; color: #18181b; margin: 0 0 16px;">' || v_title || '</h2><p style="font-size: 15px; line-height: 1.6; color: #3f3f46;">Hi ' || COALESCE(v_user.first_name, 'there') || ',</p><div style="font-size: 15px; line-height: 1.6; color: #3f3f46;">' || v_body || '</div><div style="text-align: center; margin: 24px 0;"><a href="https://techfleetnetwork.lovable.app/project-openings/' || v_project_id || '" style="display: inline-block; background-color: #18181b; color: #ffffff; font-size: 14px; font-weight: 600; padding: 12px 24px; border-radius: 6px; text-decoration: none;">View Project</a></div><hr style="border: none; border-top: 1px solid #e4e4e7; margin: 24px 0;" /><p style="font-size: 12px; color: #a1a1aa; text-align: center; margin: 0;">You received this because you opted in to training opportunity alerts on Tech Fleet Network.<br/><a href="https://techfleetnetwork.lovable.app/profile/edit?tab=preferences" style="color: #3b82f6;">Update notification preferences</a></p></div></div></body></html>',
            'text', 'Hi ' || COALESCE(v_user.first_name, 'there') || E',\n\n' || v_title || E'\n\n' || v_plain_text || E'\n\nView project: https://techfleetnetwork.lovable.app/project-openings/' || v_project_id,
            'from', 'Tech Fleet <onboarding@techfleet.org>',
            'sender_domain', 'notify.techfleet.org',
            'purpose', 'transactional',
            'label', 'project_opening_alert',
            'unsubscribe_token', v_unsub_token,
            'queued_at', now()::text
          ),
          v_message_id,
          v_message_id
        );
      EXCEPTION WHEN OTHERS THEN
        BEGIN
          INSERT INTO public.email_send_log (recipient_email, template_name, status, error_message, message_id, metadata)
          VALUES (v_user.email, 'project_opening_alert', 'failed', SQLERRM, v_message_id,
                  jsonb_build_object('source','fanout','job_id',p_job_id,'project_id',v_project_id));
        EXCEPTION WHEN OTHERS THEN NULL; END;
        RAISE WARNING 'fanout: email enqueue failed for %: %', v_user.email, SQLERRM;
      END;
    END IF;

    v_processed := v_processed + 1;
  END LOOP;

  SELECT count(*) INTO v_total_after
  FROM public.profiles p
  WHERE p.notify_training_opportunities = true AND 'Train on project teams' = ANY(p.interests);
  v_remaining := GREATEST(v_total_after - (v_job.next_offset + v_processed), 0);

  IF v_remaining = 0 THEN
    UPDATE public.notification_fanout_jobs SET status='done', next_offset=v_job.next_offset+v_processed, finished_at=now() WHERE id=p_job_id;
  ELSE
    UPDATE public.notification_fanout_jobs SET status='pending', next_offset=v_job.next_offset+v_processed WHERE id=p_job_id;
  END IF;

  RETURN jsonb_build_object('processed',v_processed,'remaining',v_remaining,'done',v_remaining=0,'job_id',p_job_id);
EXCEPTION WHEN OTHERS THEN
  UPDATE public.notification_fanout_jobs SET status='error', last_error=SQLERRM WHERE id=p_job_id;
  RAISE;
END;
$function$;

-- Reconciler: reproduced verbatim from 20260809130050, ONLY the raw re-enqueue at line 147 is
-- reshaped to enqueue_email_v2. It only ever re-queues LEGACY stragglers (messages with no
-- email_outbox row — the v2-awareness guard excludes v2 messages), so forwarding them to the v2
-- outbox delivers them and, on the next run, the same guard skips them (they now have an outbox
-- row). No infinite loop; the message_id (v_msg_id) is preserved so the email_send_log bookkeeping
-- and the v2 terminal write-back correlate.
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

      -- v2 reshape: previously re-enqueued onto the raw pgmq path (now retired).
      PERFORM public.enqueue_email_v2(
        CASE
          WHEN v_queue_name = 'bulk_emails' THEN 'bulk'
          WHEN v_queue_name = 'auth_emails' THEN 'auth'
          ELSE 'transactional'
        END,
        COALESCE(NULLIF(v_payload->>'label', ''), NULLIF(v_payload->>'template', ''), v_latest_row.template_name, 'legacy'),
        v_payload->>'to',
        v_payload->>'subject',
        v_payload,
        v_msg_id,
        v_msg_id
      );
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
