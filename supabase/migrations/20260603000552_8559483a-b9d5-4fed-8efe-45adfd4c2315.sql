
DROP TRIGGER IF EXISTS audit_profiles_trigger ON public.profiles;
DROP TRIGGER IF EXISTS trg_audit_general_application ON public.general_applications;
DROP TRIGGER IF EXISTS audit_project_application_trigger ON public.project_applications;
DROP TRIGGER IF EXISTS audit_project_changes ON public.projects;

INSERT INTO public.audit_sink_registry (table_name, mode, sink, notes) VALUES
  ('profiles',              'semantic', 'audit_log',  'privileged-only via trg_audit_profiles_privileged'),
  ('projects',              'semantic', 'audit_log',  'targeted via trg_audit_projects_change'),
  ('general_applications',  'semantic', 'audit_log',  'status + submit via dedicated triggers'),
  ('project_applications',  'semantic', 'audit_log',  'status via trg_audit_project_applications_status'),
  ('journey_progress',      'semantic', 'audit_log',  'complete + uncomplete-guard'),
  ('notifications',         'none',     'ops_events', 'no audit, fan-out tracked via ops_events'),
  ('announcement_reads',    'none',     'ops_metrics','counter only'),
  ('email_send_log',        'none',     'ops_events', 'native log table; do not double-audit'),
  ('agent_fix_queue',       'none',     'ops_events', 'triage queue; no audit'),
  ('audit_log',             'none',     'audit_log',  'self-referential; never write to self via registry')
ON CONFLICT (table_name) DO UPDATE
  SET mode = EXCLUDED.mode,
      sink = EXCLUDED.sink,
      notes = EXCLUDED.notes,
      updated_at = now();

DROP TRIGGER IF EXISTS trg_audit_sink_registry_updated_at ON public.audit_sink_registry;
CREATE TRIGGER trg_audit_sink_registry_updated_at
  BEFORE UPDATE ON public.audit_sink_registry
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
