
-- SECURITY DEFINER RPC: lets a member uncomplete a self-report quest step
-- by routing through a server function that sets app.allow_uncomplete=on
-- locally, satisfying the journey_progress uncomplete guard trigger.
CREATE OR REPLACE FUNCTION public.set_self_report_step_incomplete(p_step_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_task text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_step_id IS NULL OR length(btrim(p_step_id)) = 0 THEN
    RAISE EXCEPTION 'step_id required' USING ERRCODE = '22023';
  END IF;
  v_task := 'quest-step-' || p_step_id;

  -- Permit the uncomplete-guard trigger for this transaction only.
  PERFORM set_config('app.allow_uncomplete', 'on', true);

  UPDATE public.journey_progress
     SET completed = false,
         completed_at = NULL,
         updated_at = now()
   WHERE user_id = v_user
     AND phase = 'first_steps'
     AND task_id = v_task;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_self_report_step_incomplete(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_self_report_step_incomplete(text) TO authenticated, service_role;

INSERT INTO public.bdd_scenarios (feature_area, feature_area_number, scenario_id, title, gherkin, status, test_type, notes)
VALUES
  ('journey/quest', 64005, 'QUEST-UNCOMPLETE-001',
   'Members can mark a self-report quest step incomplete',
   'Feature: Quest self-report uncomplete flow
  Scenario: Member confirms uncomplete from the dialog
    Given a signed-in member has a quest-step task marked completed in journey_progress
    When they confirm the Mark step incomplete dialog
    Then [UI] no error toast appears and the step renders as not completed
      And [DB] journey_progress.completed = false for (user, first_steps, quest-step-<id>)
      And [Code] the call uses RPC set_self_report_step_incomplete which sets app.allow_uncomplete locally to satisfy the uncomplete guard',
   'implemented', 'unit', 'Root-cause fix for triage fingerprint mutation.anonymous: We couldn''t update that step.')
ON CONFLICT (scenario_id) DO UPDATE SET
  title = EXCLUDED.title,
  gherkin = EXCLUDED.gherkin,
  status = EXCLUDED.status,
  test_type = EXCLUDED.test_type,
  notes = EXCLUDED.notes,
  updated_at = now();

-- Resolve the two open triage rows now that the root cause is shipping.
UPDATE public.agent_fix_queue
SET status = 'resolved',
    resolved_at = now(),
    dismissed_reason = 'root_cause_fix: added SECURITY DEFINER RPC set_self_report_step_incomplete; uncomplete path now sets app.allow_uncomplete locally so journey_progress guard trigger passes (QUEST-UNCOMPLETE-001)',
    updated_at = now()
WHERE status NOT IN ('resolved','dismissed','wont_fix')
  AND (
    fingerprint LIKE 'client_error::mutation.anonymous::AppError: We couldn''t update that step%'
    OR fingerprint = '29f10eed194566b97442b34f65ddf9dec8264ecbe1471b0489c926bc963cd3f4'
  );
