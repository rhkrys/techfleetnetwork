
ALTER FUNCTION public.get_network_stats() PARALLEL SAFE;
ALTER FUNCTION public.get_course_completion_counts(jsonb) PARALLEL SAFE;
ALTER FUNCTION public.get_i18n_bundle(text, text) PARALLEL SAFE;
ALTER FUNCTION public.get_current_policy(text, text) PARALLEL SAFE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'security_events' AND relnamespace = 'public'::regnamespace AND relpersistence = 'p') THEN
    ALTER TABLE public.security_events SET UNLOGGED;
  END IF;
END $$;

REVOKE EXECUTE ON FUNCTION public.get_audit_policy() FROM anon;

CREATE OR REPLACE FUNCTION public.write_audit_log_batch(p_events jsonb)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int := 0;
  v_event jsonb;
BEGIN
  IF p_events IS NULL OR jsonb_typeof(p_events) <> 'array' THEN
    RETURN 0;
  END IF;
  IF jsonb_array_length(p_events) > 50 THEN
    RAISE EXCEPTION 'write_audit_log_batch: max 50 events per call';
  END IF;
  FOR v_event IN SELECT * FROM jsonb_array_elements(p_events) LOOP
    PERFORM public.write_audit_log(
      (v_event->>'event_type')::text,
      COALESCE(v_event->>'table_name', 'edge_function'),
      COALESCE(v_event->>'record_id', ''),
      NULLIF(v_event->>'user_id','')::uuid,
      CASE WHEN v_event ? 'changed_fields'
           THEN ARRAY(SELECT jsonb_array_elements_text(v_event->'changed_fields'))
           ELSE ARRAY[]::text[] END,
      NULLIF(v_event->>'error_message','')
    );
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END $$;

REVOKE ALL ON FUNCTION public.write_audit_log_batch(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.write_audit_log_batch(jsonb) TO service_role;

INSERT INTO public.bdd_scenarios (scenario_id, feature_area, feature_area_number, title, gherkin, status, test_type) VALUES
('W3-PARALLEL-001','Wave 3 perf',3,'Hot read RPCs are PARALLEL SAFE',
'Feature: Wave 3 perf — PARALLEL SAFE
  Scenario: Planner can parallelize hot read RPCs
    Given get_network_stats, get_course_completion_counts, get_i18n_bundle, get_current_policy are marked PARALLEL SAFE
    When the planner evaluates a SELECT that calls any of these functions
    Then [DB] pg_proc.proparallel is ''s'' for all four functions
    And [Code] no app-side change required
    And [UI] response latency unchanged or improved','implemented','none'),
('W3-UNLOG-002','Wave 3 perf',3,'security_events is UNLOGGED',
'Feature: Wave 3 perf — UNLOGGED telemetry
  Scenario: security_events INSERT is faster
    Given security_events is an append-only telemetry table
    When an INSERT is written
    Then [DB] pg_class.relpersistence = ''u''
    And [Code] writers unchanged
    And [UI] no visible change','implemented','none'),
('W3-AUDIT-003','Wave 3 perf',3,'write_audit_log_batch flushes up to 50 events',
'Feature: Wave 3 perf — batched audit
  Scenario: Edge functions flush 50 events in one round-trip
    Given an edge function buffers audit events
    When it calls write_audit_log_batch with an array of 50 events
    Then [DB] 50 rows inserted into audit_log in one round-trip
    And [Code] RPC returns 50
    And [UI] no user-visible change','implemented','none'),
('W3-AUDPOL-004','Wave 3 security',3,'get_audit_policy not exposed to anon',
'Feature: Wave 3 security — audit policy hidden from anon
  Scenario: Anon callers cannot read rate-limit caps
    Given anon JWT only
    When anon calls get_audit_policy via PostgREST
    Then [DB] EXECUTE is denied
    And [Code] response is 403/permission denied
    And [UI] no user-visible impact','implemented','none'),
('W3-PREWARM-005','Wave 3 perf',3,'prewarm-ugc-worker batches done updates',
'Feature: Wave 3 perf — batched job-status updates
  Scenario: Worker writes one UPDATE per status set
    Given a batch of N completed jobs
    When the worker finishes the batch
    Then [DB] single UPDATE ... IN (doneIds) replaces N updates
    And [Code] update is called once per status group
    And [UI] translations appear no later than before','implemented','none'),
('W3-JITTER-006','Wave 3 resilience',3,'fleety-embed and prewarm retry use exp backoff + jitter',
'Feature: Wave 3 resilience — backoff with jitter
  Scenario: Retries do not thunder-herd the upstream
    Given the upstream returns 429 or 5xx
    When the function retries
    Then [Code] delay = base * 2^attempt + random jitter, capped
    And [DB] no thundering herd
    And [UI] eventual success or graceful failure','implemented','none'),
('W3-DOM-007','Wave 3 perf',3,'DOM translator walks via requestIdleCallback',
'Feature: Wave 3 perf — chunked DOM walk
  Scenario: Language switch yields to the main thread
    Given user switches language
    When the translator walks the document
    Then [Code] walk is chunked across idle callbacks (fallback to setTimeout)
    And [UI] no long task on language switch
    And [DB] no extra calls','implemented','none'),
('W3-EVENT-008','Wave 3 security',3,'Fleety widget opens via CustomEvent not global',
'Feature: Wave 3 security — CustomEvent replaces window global
  Scenario: UniversalSearch opens Fleety without window.__openFleetyWidget
    Given UniversalSearch wants to open Fleety with a query
    When it dispatches a CustomEvent ''fleety:open''
    Then [Code] window.__openFleetyWidget removed; widget listens for event
    And [UI] Ask Fleety still opens with prefilled query
    And [DB] no change','implemented','none');
