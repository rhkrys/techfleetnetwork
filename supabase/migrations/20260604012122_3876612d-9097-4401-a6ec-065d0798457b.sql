DO $$
DECLARE
  v_fix_count int := 0;
  v_audit_count int := 0;
  v_ids uuid[];
BEGIN
  SELECT array_agg(id) INTO v_ids
  FROM public.agent_fix_queue
  WHERE error_message ~* '^(error:\s*)?script error\.?(\n|$)';

  IF v_ids IS NOT NULL AND array_length(v_ids, 1) > 0 THEN
    ALTER TABLE public.triage_audit_log DISABLE TRIGGER USER;
    DELETE FROM public.triage_audit_log WHERE fix_queue_id = ANY(v_ids);
    ALTER TABLE public.triage_audit_log ENABLE TRIGGER USER;

    DELETE FROM public.agent_fix_queue WHERE id = ANY(v_ids);
    v_fix_count := array_length(v_ids, 1);
  END IF;

  ALTER TABLE public.audit_log DISABLE TRIGGER USER;
  WITH del AS (
    DELETE FROM public.audit_log
    WHERE error_message ~* '^(error:\s*)?script error\.?(\n|$)'
    RETURNING 1
  )
  SELECT count(*) INTO v_audit_count FROM del;
  ALTER TABLE public.audit_log ENABLE TRIGGER USER;

  PERFORM public.write_audit_log(
    p_event_type := 'maintenance_cleanup',
    p_table_name := 'agent_fix_queue',
    p_record_id := 'purge_legacy_opaque_script_error',
    p_user_id := NULL,
    p_error_message := format(
      'Purged %s legacy opaque Script error rows from agent_fix_queue and %s from audit_log (pre-2026-06-02 trigger).',
      v_fix_count, v_audit_count
    ),
    p_changed_fields := ARRAY['severity:info', 'source:migration', 'bdd:TRIAGE-NOISE-032']
  );
END $$;