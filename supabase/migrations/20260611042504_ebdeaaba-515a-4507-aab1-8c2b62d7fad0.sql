-- Refactor get_dashboard_overview to derive identity from auth.uid() only.
-- Removes the dual-source-of-truth race that produced AppError: Unauthorized
-- on the dashboard whenever the JWT refresh briefly lagged the React context.

CREATE OR REPLACE FUNCTION public.get_dashboard_overview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid          uuid := auth.uid();
  v_phase_counts jsonb;
  v_general_app  jsonb;
  v_project_apps jsonb;
BEGIN
  -- No session = empty payload (not an exception). Dashboard renders empty
  -- state silently during the ~200ms auth-refresh window; React Query will
  -- retry once the session resettles.
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object(
      'phase_counts',         '{}'::jsonb,
      'general_application',  NULL,
      'project_applications', '[]'::jsonb
    );
  END IF;

  SELECT jsonb_object_agg(phase::text, cnt) INTO v_phase_counts
  FROM (
    SELECT phase, count(*) AS cnt
    FROM public.journey_progress
    WHERE user_id = v_uid AND completed = true
    GROUP BY phase
  ) sub;

  SELECT to_jsonb(ga) INTO v_general_app
  FROM (
    SELECT id, status, completed_at, updated_at, current_section
    FROM public.general_applications
    WHERE user_id = v_uid
    LIMIT 1
  ) ga;

  SELECT jsonb_agg(row_to_json(t)) INTO v_project_apps
  FROM (
    SELECT id, project_id, status, applicant_status, completed_at, updated_at,
           current_step, team_hats_interest
    FROM public.project_applications
    WHERE user_id = v_uid
    ORDER BY updated_at DESC
  ) t;

  RETURN jsonb_build_object(
    'phase_counts',         COALESCE(v_phase_counts, '{}'::jsonb),
    'general_application',  v_general_app,
    'project_applications', COALESCE(v_project_apps, '[]'::jsonb)
  );
END
$function$;

REVOKE ALL    ON FUNCTION public.get_dashboard_overview()      FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_dashboard_overview()      TO authenticated, service_role;

-- Drop the old (uuid) overload so nothing can call it again.
DROP FUNCTION IF EXISTS public.get_dashboard_overview(uuid);

-- Catalog the pre-deploy fingerprint so any residual occurrences in the
-- 30-day window auto-close in Triage instead of paging.
INSERT INTO public.known_issue_catalog (pattern, match_kind, event_type_filter, reason, expires_at, is_active)
VALUES (
  'AppError: Unauthorized',
  'substring',
  'query.dashboard-overview',
  'Resolved by single-source-of-truth refactor: get_dashboard_overview() now uses auth.uid() directly. Residual pre-deploy occurrences auto-close.',
  now() + interval '30 days',
  true
)
ON CONFLICT (pattern, match_kind, event_type_filter) DO UPDATE
  SET reason = EXCLUDED.reason,
      expires_at = EXCLUDED.expires_at,
      is_active = true,
      updated_at = now();

-- BDD scenarios
INSERT INTO public.bdd_scenarios (feature_area, feature_area_number, scenario_id, title, gherkin, status, test_type)
VALUES
('Dashboard Overview', 1, 'DASH-OVR-001', 'Signed-in member loads dashboard',
 'Given a signed-in member with a valid session
When the dashboard query fires get_dashboard_overview()
Then [UI] the dashboard renders the member''s widgets
And  [DB] exactly one call is made to public.get_dashboard_overview() with zero arguments
And  [Code] the React Query resolves with phase_counts, general_application, project_applications keys',
 'not_built', 'none'),

('Dashboard Overview', 1, 'DASH-OVR-002', 'Transient missing session degrades gracefully',
 'Given the GoTrue session is briefly absent during a token refresh
When get_dashboard_overview() is invoked
Then [UI] the dashboard renders an empty state silently (no toast, no error boundary)
And  [DB] no audit_log row is written with severity:error for fingerprint query.dashboard-overview
And  [Code] the RPC returns {phase_counts:{}, general_application:null, project_applications:[]}',
 'not_built', 'none'),

('Dashboard Overview', 1, 'DASH-OVR-003', 'Legacy uuid overload is removed',
 'Given the refactor migration has run
When any caller invokes get_dashboard_overview(<uuid>)
Then [UI] no surface depends on the old signature (callsite grep is clean)
And  [DB] pg_proc contains exactly one row for public.get_dashboard_overview with pronargs = 0
And  [Code] Postgres returns 42883 function does not exist for the (uuid) overload',
 'not_built', 'none')
ON CONFLICT (scenario_id) DO UPDATE
  SET title    = EXCLUDED.title,
      gherkin  = EXCLUDED.gherkin,
      updated_at = now();