CREATE OR REPLACE FUNCTION public.resolve_stale_fingerprints_on_deploy(
  p_fingerprint_like text,
  p_reason text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF p_fingerprint_like IS NULL OR length(p_fingerprint_like) < 4 THEN
    RAISE EXCEPTION 'p_fingerprint_like must be a non-trivial LIKE pattern';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'p_reason is required for audit trail';
  END IF;

  UPDATE public.agent_fix_queue
     SET status = 'resolved',
         resolved_at = now(),
         updated_at = now(),
         dismissed_reason = COALESCE(dismissed_reason, p_reason)
   WHERE status IN ('pending', 'triaged', 'proposed')
     AND (fingerprint ILIKE p_fingerprint_like
          OR error_message ILIKE p_fingerprint_like);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_stale_fingerprints_on_deploy(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_stale_fingerprints_on_deploy(text, text) TO service_role;

INSERT INTO public.known_issue_catalog (pattern, match_kind, event_type_filter, is_active, reason, expires_at)
VALUES
  ('^SerializationError:\s*Non-Error thrown:\s*\{?\s*"?message"?\s*:\s*""\s*\}?\s*$', 'regex', 'client_error', true, 'Opaque empty non-Error payload. Filtered at reporter; database backstop for stale bundles.', now() + interval '30 days'),
  ('^SerializationError:\s*Non-Error thrown:\s*\{\s*\}?\s*$', 'regex', 'client_error', true, 'Opaque empty non-Error payload. Filtered at reporter; database backstop for stale bundles.', now() + interval '30 days')
ON CONFLICT (pattern, match_kind, event_type_filter) DO UPDATE
SET is_active = true,
    reason = EXCLUDED.reason,
    expires_at = EXCLUDED.expires_at,
    updated_at = now();

SELECT public.resolve_stale_fingerprints_on_deploy(
  '%get_dashboard_overview(p_user_id)%',
  'shim_deployed_2026-06-14'
);

SELECT public.resolve_stale_fingerprints_on_deploy(
  '%Could not find the function public.%in the schema cache%',
  'stale_bundle_post_shim'
);

SELECT public.resolve_stale_fingerprints_on_deploy(
  '%SerializationError: Non-Error thrown:%message%:%""%',
  'opaque_empty_serialization_payload'
);

INSERT INTO public.bdd_scenarios (scenario_id, feature_area, feature_area_number, title, gherkin, status, test_type, test_file)
VALUES
  (
    'TRIAGE-NOISE-013',
    'System Health Triage',
    19,
    'Dynamic source fingerprints collapse to one actionable triage row',
    $bdd$Feature: Triage source fingerprint normalization
  Scenario: The same journey count failure occurs for multiple members and task lists
    Given two client errors share the message "Failed to count progress" but have different member UUIDs and task-id lists in their source
    When the client reporter builds the triage fingerprint
    Then [UI] System Health Triage shows one grouped incident instead of one row per member
    And [DB] agent_fix_queue has one normalized fingerprint whose occurrence_count increases
    And [Code] normalizeFingerprintKey replaces UUIDs with :id and dynamic id lists with :list before upsert_fix_queue_entry runs$bdd$,
    'implemented'::public.bdd_status,
    'unit'::public.bdd_test_type,
    'src/test/services/error-reporter.fingerprint.test.ts'
  ),
  (
    'TRIAGE-NOISE-014',
    'System Health Triage',
    19,
    'Opaque empty SerializationError payloads are dropped before triage',
    $bdd$Feature: Triage opaque serialization suppression
  Scenario: React Query throws an empty non-Error payload
    Given the reporter receives "SerializationError: Non-Error thrown: {\"message\":\"\"}"
    When every reporter entrypoint evaluates the message
    Then [UI] no System Health Triage row or member-facing error appears for the opaque payload
    And [DB] known_issue_catalog contains an active 30-day regex backstop and agent_fix_queue receives no matching row
    And [Code] isOpaqueScriptErrorMessage returns true from the first non-empty line$bdd$,
    'implemented'::public.bdd_status,
    'unit'::public.bdd_test_type,
    'src/test/services/error-reporter.fingerprint.test.ts'
  ),
  (
    'TRIAGE-NOISE-015',
    'System Health Triage',
    19,
    'Journey completed count transient failures degrade without opening triage',
    $bdd$Feature: Journey completed-count graceful degradation
  Scenario: The completed-count query hits a transient backend blip
    Given getCompletedCount receives a transient PostgREST or HTTP 5xx error
    When the journey progress hook refetches the completed count
    Then [UI] the previous count remains visible or the count safely degrades without crashing the dashboard
    And [DB] no agent_fix_queue row is inserted for the transient count blip
    And [Code] JourneyService.getCompletedCount returns 0 for isTransientError matches and rethrows structural errors$bdd$,
    'implemented'::public.bdd_status,
    'unit'::public.bdd_test_type,
    'src/test/services/journey.service.graceful-degrade.test.ts'
  ),
  (
    'TRIAGE-NOISE-016',
    'System Health Triage',
    19,
    'Deploy cleanup resolves stale schema-cache residue after a shim ships',
    $bdd$Feature: Deploy-time stale triage residue cleanup
  Scenario: A stale bundle reports a schema-cache error after the compatibility shim is live
    Given agent_fix_queue contains pending rows for get_dashboard_overview(p_user_id) or a public function schema-cache miss
    When resolve_stale_fingerprints_on_deploy runs during the fix migration
    Then [UI] System Health Triage no longer shows the stale residue rows
    And [DB] matching rows move to status=resolved with resolved_at and dismissed_reason populated
    And [Code] the service-role-only cleanup helper returns the number of rows it resolved$bdd$,
    'implemented'::public.bdd_status,
    'unit'::public.bdd_test_type,
    'supabase/migrations/20260620014652_f8411cfa-cf68-405f-b3d7-9a3dee225c5a.sql'
  )
ON CONFLICT (scenario_id) DO UPDATE
SET feature_area = EXCLUDED.feature_area,
    feature_area_number = EXCLUDED.feature_area_number,
    title = EXCLUDED.title,
    gherkin = EXCLUDED.gherkin,
    status = EXCLUDED.status,
    test_type = EXCLUDED.test_type,
    test_file = EXCLUDED.test_file,
    updated_at = now();