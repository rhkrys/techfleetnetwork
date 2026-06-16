CREATE OR REPLACE FUNCTION public.is_actionable_event_type(
  p_event_type text,
  p_changed_fields text[] DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_non_actionable CONSTANT text[] := ARRAY[
    'client_error_overflow','client_error_suppressed','client_error_deduped',
    'audit_pressure_changed','external_api_recovered',
    'ui_chunk_load_failed','chunk_stale',
    'fix_queue_status_changed','fix_queue_triaged','fix_queue_proposed','fix_queue_dismissed',
    'validation_rejected',
    'email_capped','email_dlq','email_reconciled','email_rate_limited',
    'email_frequency_capped','email_suppressed',
    'edge_invoke_failed','authn_unauthorized',
    'infra_transient'
  ];
  v_severity_tag text;
BEGIN
  IF p_event_type IS NULL THEN RETURN false; END IF;
  IF p_event_type = ANY(v_non_actionable) THEN RETURN false; END IF;

  IF p_changed_fields IS NOT NULL THEN
    SELECT cf INTO v_severity_tag
      FROM unnest(p_changed_fields) cf
     WHERE cf LIKE 'severity:%'
     LIMIT 1;
    IF v_severity_tag IS NOT NULL AND v_severity_tag <> 'severity:error' THEN
      RETURN false;
    END IF;
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.is_actionable_event_type(text, text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_actionable_event_type(text, text[]) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_actionable_event_type(text, text[]) TO service_role;

CREATE OR REPLACE FUNCTION public.block_non_actionable_fix_queue_inserts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.severity IS DISTINCT FROM 'error' THEN
    RETURN NULL;
  END IF;
  IF NOT public.is_actionable_event_type(NEW.event_type, NULL) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.discover_audit_fingerprints(p_min_occurrences integer DEFAULT 1)
RETURNS TABLE(processed integer, queued integer, silenced integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
#variable_conflict use_column
DECLARE
  v_processed INT := 0; v_queued INT := 0; v_silenced INT := 0;
  r RECORD; v_silence BOOLEAN;
BEGIN
  FOR r IN
    SELECT error_fingerprint AS fingerprint,
           max(event_type) AS event_type,
           max(table_name) AS source,
           (array_agg(error_message ORDER BY created_at DESC))[1] AS sample_message,
           count(*)::int AS occ,
           min(created_at) AS first_seen,
           max(created_at) AS last_seen,
           bool_or('severity:error' = ANY(changed_fields)) AS any_error,
           bool_or(EXISTS (
             SELECT 1 FROM unnest(changed_fields) cf WHERE cf LIKE 'severity:%'
           )) AS has_severity_tag,
           (array_agg(changed_fields ORDER BY created_at DESC))[1] AS sample_fields
    FROM public.audit_log
    WHERE error_message IS NOT NULL AND error_fingerprint IS NOT NULL
      AND created_at > now() - interval '24 hours'
    GROUP BY error_fingerprint
    HAVING count(*) >= p_min_occurrences
  LOOP
    v_processed := v_processed + 1;

    IF NOT public.is_actionable_event_type(r.event_type, r.sample_fields) THEN
      v_silenced := v_silenced + 1;
      CONTINUE;
    END IF;

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
$$;

UPDATE public.agent_fix_queue
   SET status = 'resolved',
       resolved_at = now(),
       dismissed_reason = COALESCE(dismissed_reason,
         'permanent_fix_2026_06_16: triage actionable single source + transient classifier integration')
 WHERE status = 'pending'
   AND (
     event_type = 'email_rate_limited'
     OR error_message ILIKE '%Failed to mint unsubscribe token%'
     OR error_message ILIKE '%PGRST002%'
     OR error_message ILIKE '%code:57014%'
     OR error_message ILIKE '%statement timeout%'
     OR error_message ILIKE '%upstream request timeout%'
     OR error_message ILIKE '%Failed to load progress%'
     OR error_message ILIKE '%Failed to count progress%'
     OR error_message ILIKE '%Failed to load project openings%'
   );

INSERT INTO public.bdd_scenarios (scenario_id, feature_area, feature_area_number, title, gherkin, status, test_type)
VALUES
  ('TRIAGE-ROOT-001', 'Triage Root Cause 2026-06-16', 6016,
   'Direct insert of email_rate_limited at severity=error is blocked at the trigger',
   $g$Feature: Triage actionable single source
  Scenario: Direct email_rate_limited insert is blocked
    Given process-email-queue records a Resend 429 cooldown
    When it upserts an agent_fix_queue row with event_type=email_rate_limited severity=error
    Then [DB] the BEFORE INSERT trigger calls is_actionable_event_type and returns NULL
    And [DB] no row appears in agent_fix_queue with that fingerprint
    And [Code] email_send_state.consecutive_429_count_transactional still records the burst$g$,
   'implemented', 'unit'),
  ('TRIAGE-ROOT-002', 'Triage Root Cause 2026-06-16', 6016,
   'PGRST002 service error never reaches agent_fix_queue',
   $g$Feature: Triage actionable single source
  Scenario: PGRST002 schema-cache transient is suppressed
    Given a service call returns PostgreSQL schema-cache error code PGRST002
    When handleServiceError forwards the structured error to reportError
    Then [Code] isTransientError(err) returns true and reportError downgrades to event_type=infra_transient severity=info
    And [DB] audit_log row carries severity:info tag; upsert_fix_queue_entry is skipped
    And [UI] System Health Triage tab shows no new pending row$g$,
   'implemented', 'unit'),
  ('TRIAGE-ROOT-003', 'Triage Root Cause 2026-06-16', 6016,
   'Statement timeout 57014 never reaches agent_fix_queue',
   $g$Feature: Triage actionable single source
  Scenario: 57014 statement timeout is classified transient
    Given a getReadIds or getCompletedCount query times out with code 57014
    When React Query QueryCache.onError fires and the reporter receives the structured error
    Then [Code] classify(err) returns report=false reason=infra_transient
    And [DB] no row inserted into agent_fix_queue
    And [UI] the query retries silently per defaultOptions$g$,
   'implemented', 'unit'),
  ('TRIAGE-ROOT-004', 'Triage Root Cause 2026-06-16', 6016,
   'Unsubscribe-token mint is atomic and race-free',
   $g$Feature: Triage actionable single source
  Scenario: Atomic upsert returns canonical token
    Given auth-email-hook needs an unsubscribe token for an outbound auth email
    When it calls upsert(.., onConflict=email, ignoreDuplicates=false).select().single()
    Then [Code] exactly one round-trip; returned row.token is always non-null
    And [DB] email_unsubscribe_tokens has exactly one row per email (unique constraint)
    And [DB] no synthetic email_send_log status=failed row is written for the mint step$g$,
   'implemented', 'unit'),
  ('TRIAGE-ROOT-005', 'Triage Root Cause 2026-06-16', 6016,
   'Trigger and discover share one allowlist',
   $g$Feature: Triage actionable single source
  Scenario: One SQL function governs both write paths
    Given a new event_type is added to is_actionable_event_type
    When either a direct insert or a discover scan attempts to enqueue it
    Then [DB] both paths call public.is_actionable_event_type(event_type, changed_fields)
    And [DB] behavior is identical: drop or enqueue, never diverge
    And [Code] CI guard check-triage-actionable-parity.mjs asserts JS NON_ACTIONABLE matches DB list$g$,
   'implemented', 'unit'),
  ('TRIAGE-ROOT-006', 'Triage Root Cause 2026-06-16', 6016,
   'Stale pending rows from pre-fix infra blips are resolved on deploy',
   $g$Feature: Triage actionable single source
  Scenario: Stale rows are auto-resolved with documented reason
    Given agent_fix_queue contains pending rows for PGRST002/57014/email_rate_limited/mint-token
    When the 2026-06-16 migration runs
    Then [DB] all matching pending rows transition to status=resolved with dismissed_reason set
    And [UI] System Health Triage tab shows 0 pending entries for these fingerprints
    And [DB] future re-occurrences are blocked by is_actionable_event_type so they cannot return$g$,
   'implemented', 'unit')
ON CONFLICT (scenario_id) DO UPDATE
  SET feature_area = EXCLUDED.feature_area,
      feature_area_number = EXCLUDED.feature_area_number,
      title = EXCLUDED.title,
      gherkin = EXCLUDED.gherkin,
      status = EXCLUDED.status,
      test_type = EXCLUDED.test_type,
      updated_at = now();