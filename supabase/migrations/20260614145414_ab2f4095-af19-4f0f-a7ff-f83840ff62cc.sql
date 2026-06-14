CREATE OR REPLACE FUNCTION public.get_dashboard_overview(p_user_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.get_dashboard_overview();
$$;

REVOKE ALL ON FUNCTION public.get_dashboard_overview(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_dashboard_overview(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_dashboard_overview(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_dashboard_overview(uuid) IS
  'Back-compat shim for cached browser bundles. Delegates to get_dashboard_overview() (0-arg). p_user_id is ignored — canonical impl reads auth.uid().';

UPDATE public.agent_fix_queue
   SET status = 'resolved',
       resolved_at = now()
 WHERE status IN ('open', 'in_progress', 'triaged')
   AND (
     fingerprint ILIKE '%get_dashboard_overview(p_user_id)%'
     OR (error_message ILIKE '%get_dashboard_overview%' AND error_message ILIKE '%schema cache%')
   );

INSERT INTO public.bdd_scenarios (scenario_id, feature_area, feature_area_number, title, gherkin, status, test_type)
VALUES (
  'DASHBOARD-RPC-COMPAT-001',
  'Dashboard',
  7,
  'Cached bundles calling legacy 1-arg get_dashboard_overview still load',
  $bdd$Feature: Dashboard RPC backward compatibility
  Scenario: Cached bundle passes p_user_id to get_dashboard_overview
    Given an authenticated member is on a cached bundle that calls get_dashboard_overview(p_user_id)
    When the dashboard query fires
    Then [UI] the dashboard renders with widgets and no error toast
    And  [DB] PostgREST resolves the 1-arg overload and returns the same jsonb as the 0-arg form
    And  [Code] no PGRST202 / "schema cache" error is enqueued to agent_fix_queue$bdd$,
  'implemented',
  'manual'
)
ON CONFLICT (scenario_id) DO UPDATE
  SET gherkin = EXCLUDED.gherkin,
      status  = EXCLUDED.status;