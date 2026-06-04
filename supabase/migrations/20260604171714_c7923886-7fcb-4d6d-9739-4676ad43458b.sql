-- A. Reclassify benign email lifecycle events so they never reach Triage.
CREATE OR REPLACE FUNCTION public.audit_email_send_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  resolved_event text;
  v_benign      boolean;
  v_fields      text[];
  v_err         text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_benign := NEW.status IN ('reconciled','rate_limited','frequency_capped','suppressed');
    v_fields := ARRAY[
      COALESCE(NEW.template_name, ''),
      COALESCE(NEW.recipient_email, ''),
      COALESCE(NEW.status, '')
    ];
    IF v_benign THEN
      -- Tag as severity:info so discover_audit_fingerprints skips it, and
      -- move the human note into changed_fields (never into error_message,
      -- which is what discovery scans).
      v_fields := v_fields || ARRAY['severity:info'];
      IF NEW.error_message IS NOT NULL THEN
        v_fields := v_fields || ARRAY['note:' || left(regexp_replace(NEW.error_message, '[^A-Za-z0-9_.:-]', '_', 'g'), 80)];
      END IF;
      v_err := NULL;
    ELSE
      v_err := NEW.error_message;
    END IF;

    PERFORM public.try_write_audit_log(
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

  RETURN COALESCE(NEW, OLD);
END;
$function$;

-- Defense in depth: exclude benign email lifecycle events from discovery.
CREATE OR REPLACE FUNCTION public.discover_audit_fingerprints(p_min_occurrences integer DEFAULT 1)
 RETURNS TABLE(processed integer, queued integer, silenced integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  v_processed INT := 0; v_queued INT := 0; v_silenced INT := 0;
  r RECORD; v_silence BOOLEAN;
  v_excluded_events CONSTANT text[] := ARRAY[
    'audit_pressure_changed','external_api_recovered','client_error_deduped',
    'client_error_suppressed','client_error_overflow','ui_chunk_load_failed',
    'fix_queue_status_changed','fix_queue_triaged','fix_queue_proposed','fix_queue_dismissed',
    'email_capped','email_dlq',
    'email_reconciled','email_rate_limited','email_frequency_capped','email_suppressed',
    'edge_invoke_failed','validation_rejected','authn_unauthorized'
  ];
BEGIN
  FOR r IN
    SELECT error_fingerprint AS fingerprint, max(event_type) AS event_type,
           max(table_name) AS source,
           (array_agg(error_message ORDER BY created_at DESC))[1] AS sample_message,
           count(*)::int AS occ, min(created_at) AS first_seen, max(created_at) AS last_seen,
           bool_or('severity:error' = ANY(changed_fields)) AS any_error,
           bool_or(EXISTS (
             SELECT 1 FROM unnest(changed_fields) cf WHERE cf LIKE 'severity:%'
           )) AS has_severity_tag
    FROM public.audit_log
    WHERE error_message IS NOT NULL AND error_fingerprint IS NOT NULL
      AND created_at > now() - interval '24 hours'
      AND event_type <> ALL (v_excluded_events)
    GROUP BY error_fingerprint
    HAVING count(*) >= p_min_occurrences
  LOOP
    v_processed := v_processed + 1;

    IF r.has_severity_tag AND NOT r.any_error THEN
      v_silenced := v_silenced + 1;
      CONTINUE;
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM public.known_issue_catalog k
      WHERE k.is_active AND (k.expires_at IS NULL OR k.expires_at > now())
        AND (k.event_type_filter IS NULL OR k.event_type_filter = r.event_type)
        AND ((k.match_kind = 'substring' AND r.sample_message ILIKE '%' || k.pattern || '%')
          OR (k.match_kind = 'fingerprint' AND r.fingerprint = k.pattern)
          OR (k.match_kind = 'regex' AND r.sample_message ~ k.pattern))
    ) INTO v_silence;
    IF v_silence THEN v_silenced := v_silenced + 1; CONTINUE; END IF;

    INSERT INTO public.agent_fix_queue
      (fingerprint, event_type, source, error_message, severity, status,
       occurrence_count, first_seen_at, last_seen_at)
    VALUES (r.fingerprint, r.event_type, r.source, left(r.sample_message, 4000),
            'error', 'pending', r.occ, r.first_seen, r.last_seen)
    ON CONFLICT (fingerprint) DO UPDATE
      SET occurrence_count = GREATEST(agent_fix_queue.occurrence_count, EXCLUDED.occurrence_count),
          last_seen_at = GREATEST(agent_fix_queue.last_seen_at, EXCLUDED.last_seen_at),
          error_message = COALESCE(NULLIF(agent_fix_queue.error_message,''), EXCLUDED.error_message),
          updated_at = now()
      WHERE agent_fix_queue.status IN ('pending','triaged','proposed');
    v_queued := v_queued + 1;
  END LOOP;
  RETURN QUERY SELECT v_processed, v_queued, v_silenced;
END;
$function$;