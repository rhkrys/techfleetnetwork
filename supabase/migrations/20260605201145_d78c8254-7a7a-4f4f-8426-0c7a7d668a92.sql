-- Make audit_email_send_log treat "Duplicate enqueue reconciled" sent rows as benign.
-- These are written by the duplicate-send guard in process-email-queue when pgmq
-- redelivers an already-sent message; they are normal reconciliation, not failures,
-- and must never reach Triage as severity=error.

CREATE OR REPLACE FUNCTION public.audit_email_send_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  resolved_event text;
  v_benign      boolean;
  v_is_reconciled_sent boolean;
  v_fields      text[];
  v_err         text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_is_reconciled_sent :=
      NEW.status = 'sent'
      AND NEW.error_message IS NOT NULL
      AND NEW.error_message LIKE 'Duplicate enqueue reconciled%';

    v_benign :=
      NEW.status IN ('reconciled','rate_limited','frequency_capped','suppressed')
      OR v_is_reconciled_sent;

    v_fields := ARRAY[
      COALESCE(NEW.template_name, ''),
      COALESCE(NEW.recipient_email, ''),
      COALESCE(NEW.status, '')
    ];
    IF v_benign THEN
      v_fields := v_fields || ARRAY['severity:info'];
      IF v_is_reconciled_sent THEN
        v_fields := v_fields || ARRAY['reconciled:duplicate_enqueue'];
      END IF;
      IF NEW.error_message IS NOT NULL THEN
        v_fields := v_fields || ARRAY['note:' || left(regexp_replace(NEW.error_message, '[^A-Za-z0-9_.:-]', '_', 'g'), 80)];
      END IF;
      v_err := NULL;
    ELSE
      v_err := NEW.error_message;
    END IF;

    PERFORM public.try_write_audit_log(
      CASE
        WHEN v_is_reconciled_sent THEN 'email_reconciled'
        ELSE
          CASE NEW.status
            WHEN 'pending' THEN 'email_queued'
            WHEN 'sent' THEN 'email_sent'
            WHEN 'failed' THEN 'email_failed'
            WHEN 'dlq' THEN 'email_dlq'
            WHEN 'rate_limited' THEN 'email_rate_limited'
            WHEN 'suppressed' THEN 'email_suppressed'
            WHEN 'bounced' THEN 'email_bounced'
            WHEN 'complained' THEN 'email_complained'
            WHEN 'reconciled' THEN 'email_reconciled'
            WHEN 'frequency_capped' THEN 'email_frequency_capped'
            ELSE 'email_' || NEW.status
          END
      END,
      'email_send_log',
      COALESCE(NEW.message_id, NEW.id::text),
      auth.uid(),
      v_fields,
      v_err
    );
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IN ('failed','dlq','bounced','complained') THEN
    resolved_event := CASE NEW.status
      WHEN 'failed' THEN 'email_failed'
      WHEN 'dlq' THEN 'email_dlq'
      WHEN 'bounced' THEN 'email_bounced'
      WHEN 'complained' THEN 'email_complained'
    END;
    PERFORM public.try_write_audit_log(
      resolved_event,
      'email_send_log',
      COALESCE(NEW.message_id, NEW.id::text),
      auth.uid(),
      ARRAY[
        COALESCE(NEW.template_name, ''),
        COALESCE(NEW.recipient_email, ''),
        COALESCE(NEW.status, ''),
        'transition:' || COALESCE(OLD.status,'null') || '->' || NEW.status
      ],
      NEW.error_message
    );
  END IF;

  RETURN NEW;
END;
$function$;

-- Resolve the open triage rows produced by both fingerprints. The trigger fix
-- + edge function redeploy prevent any new occurrences; existing rows are
-- noise that can be cleared.
UPDATE public.agent_fix_queue
SET status = 'resolved',
    resolved_at = now(),
    dismissed_reason = 'fixed_by_permanent_redeploy_and_trigger_guard_2026_06_05'
WHERE status = 'pending'
  AND (error_message LIKE 'Duplicate enqueue reconciled%'
       OR error_message = 'supabase.rpc(...).catch is not a function');
