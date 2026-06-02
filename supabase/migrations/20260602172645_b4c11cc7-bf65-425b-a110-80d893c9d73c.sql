CREATE OR REPLACE FUNCTION public.discover_audit_fingerprints(p_min_occurrences integer DEFAULT 1)
RETURNS TABLE(processed integer, queued integer, silenced integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_processed INT := 0; v_queued INT := 0; v_silenced INT := 0;
  r RECORD; v_silence BOOLEAN;
  v_excluded_events CONSTANT text[] := ARRAY[
    'audit_pressure_changed','external_api_recovered','client_error_deduped',
    'client_error_suppressed','client_error_overflow','ui_chunk_load_failed',
    'fix_queue_status_changed','fix_queue_triaged','fix_queue_proposed','fix_queue_dismissed',
    'email_capped','email_dlq',
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

-- 30-day backstop entries for opaque cross-origin "Script error." (reporter handles it client-side; this is defense-in-depth)
INSERT INTO public.known_issue_catalog (pattern, match_kind, event_type_filter, is_active, reason, expires_at)
VALUES
  ('Script error.', 'substring', 'client_error',
   true, 'Opaque cross-origin script error (CORS hides details). Filtered at reporter; DB backstop. Renew if needed.',
   now() + interval '30 days'),
  ('Script error.', 'substring', NULL,
   true, 'Opaque cross-origin script error backstop for any event_type. Renew if needed.',
   now() + interval '30 days')
ON CONFLICT DO NOTHING;

UPDATE public.agent_fix_queue
SET status = 'resolved',
    resolved_at = now(),
    dismissed_reason = 'triage_root_cause_shipped',
    updated_at = now()
WHERE id IN (
  '3662cf6a-125f-47b1-b0a6-835e307ee90f',
  'ce7fff5d-7c08-4a78-bae0-bae75bdbd079'
)
AND status <> 'resolved';

INSERT INTO public.bdd_scenarios (scenario_id, feature_area, feature_area_number, title, gherkin, status)
VALUES
  ('TRIAGE-NOISE-010', 'System Health Triage', 1,
   'Warn-severity audit rows never enter Triage via discovery',
   'Feature: Discovery scanner respects client-recorded severity

Scenario: A warn-severity edge_invoke_failed lands in audit_log
  Given the client reporter writes an edge_invoke_failed row with severity:warn into audit_log
  When discover_audit_fingerprints(1) runs
  Then [UI] System Health Triage shows no new row for that fingerprint
  And [DB] agent_fix_queue has no row with the new fingerprint
  And [Code] the function counts the fingerprint in silenced and skips the INSERT',
   'implemented'::bdd_status),
  ('TRIAGE-NOISE-011', 'System Health Triage', 1,
   'Error-severity audit rows still flow into Triage',
   'Feature: Severity gate does not over-suppress

Scenario: A client_error with severity:error lands in audit_log
  Given the client reporter writes a client_error row with severity:error
  When discover_audit_fingerprints(1) runs
  Then [UI] System Health Triage shows the row at severity=error
  And [DB] agent_fix_queue.severity = ''error'' for the fingerprint
  And [Code] bool_or(''severity:error'' = ANY(changed_fields)) is true so the INSERT runs',
   'implemented'::bdd_status),
  ('TRIAGE-NOISE-012', 'System Health Triage', 1,
   'Multi-line opaque Script error is dropped at the source',
   'Feature: Opaque cross-origin Script error never reaches audit or triage

Scenario: A React dispatchEvent path synthesizes a multi-line Script error payload
  Given the browser fires "Error: Script error." with a synthesized stack across multiple lines
  When window.onerror, reportError, or reportToAuditLog receives the payload
  Then [UI] no toast, no Triage row, no error banner
  And [DB] no audit_log insert and no agent_fix_queue row
  And [Code] isOpaqueScriptErrorMessage returns true on the first non-empty line and every entrypoint short-circuits; known_issue_catalog backstops the same pattern in discovery',
   'implemented'::bdd_status),
  ('HELP-DESK-033', 'Get Help', 4,
   'process-freescout-events accepts both bearer formats',
   'Feature: Cron worker auth parity with process-email-queue

Scenario: Cron wakes the worker with a legacy service-role JWT
  Given pg_cron invokes process-freescout-events with Authorization: Bearer <legacy service_role JWT>
  Then [UI] no authn_unauthorized row appears in Triage
  And [DB] msg_ids in q_freescout_events are removed after processing
  And [Code] authorizeServiceRoleRequest returns ok=true with mode=legacy_jwt

Scenario: Cron wakes the worker with the opaque sb_secret_ token
  Given pg_cron invokes process-freescout-events with Authorization: Bearer sb_secret_*
  Then [UI] no authn_unauthorized row appears in Triage
  And [DB] msg_ids in q_freescout_events are removed after processing
  And [Code] authorizeServiceRoleRequest returns ok=true with mode=opaque',
   'implemented'::bdd_status),
  ('HELP-DESK-034', 'Get Help', 4,
   'Missing or invalid bearer is rejected without flooding triage',
   'Feature: Bad bearers fail fast and quietly

Scenario: A request without a bearer hits the worker
  Given a POST to process-freescout-events with no Authorization header
  Then [UI] no Triage row is created
  And [DB] discovery does not enqueue (event_type authn_unauthorized is in v_excluded_events)
  And [Code] authorizeServiceRoleRequest returns ok=false status=401 and the function responds 401

Scenario: A request with a stranger bearer hits the worker
  Given a POST to process-freescout-events with Authorization: Bearer wrong
  Then [UI] no Triage row is created
  And [DB] discovery does not enqueue
  And [Code] authorizeServiceRoleRequest returns ok=false status=403 and the function responds 403',
   'implemented'::bdd_status)
ON CONFLICT (scenario_id) DO UPDATE
  SET gherkin = EXCLUDED.gherkin,
      status = EXCLUDED.status,
      feature_area = EXCLUDED.feature_area,
      feature_area_number = EXCLUDED.feature_area_number,
      title = EXCLUDED.title;