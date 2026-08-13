-- Hand-Off "ready to review" in-app notification (Phase B3, async delivery).
--
-- Production runs ~20 min in the background, so the initiator isn't watching the screen. When a run
-- completes, notify the person who started it via the sanctioned safe_create_notification (its own
-- outbox + retry + DLQ), so it's reliable and independent of the client. Done inside
-- handoff_complete_run — the single real completion path — and best-effort (a notification failure
-- must never roll back the completion). (Email to the initiator is the deferred delivery layer.)
--
-- Signature unchanged (uuid, text, integer) so this is a plain CREATE OR REPLACE.
CREATE OR REPLACE FUNCTION public.handoff_complete_run(
  p_run_id uuid, p_worker_id text, p_gap_count integer DEFAULT 0
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pid uuid; v_phase public.project_phase; v_rows integer;
  v_triggered_by uuid; v_project_name text; v_gaps integer := GREATEST(p_gap_count, 0);
  v_title text; v_body text;
BEGIN
  UPDATE public.handoff_productions SET
    status = 'complete', gap_count = v_gaps,
    worker_id = NULL, lease_expires_at = NULL, pipeline_state = NULL, updated_at = now()
  WHERE id = p_run_id AND worker_id = p_worker_id
  RETURNING project_id, phase, triggered_by INTO v_pid, v_phase, v_triggered_by;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN RETURN false; END IF;

  UPDATE public.handoff_productions SET is_latest = false, updated_at = now()
  WHERE project_id = v_pid AND phase = v_phase AND id <> p_run_id AND is_latest;

  -- Notify the initiator that their hand-offs are ready to review. Best-effort.
  BEGIN
    SELECT NULLIF(c.name, '') INTO v_project_name
    FROM public.projects pr LEFT JOIN public.clients c ON c.id = pr.client_id
    WHERE pr.id = v_pid;

    v_title := 'Your hand-offs are ready' || COALESCE(' — ' || v_project_name, '');
    v_body  := '<p>The hand-offs for '
               || COALESCE('<strong>' || v_project_name || '</strong> ', '')
               || 'are ready to view and review.'
               || CASE WHEN v_gaps > 0
                       THEN ' A few sections came through as placeholders — you can re-create to fill them.'
                       ELSE '' END
               || '</p>';

    PERFORM public.safe_create_notification(
      p_user_id           => v_triggered_by,
      p_title             => v_title,
      p_body_html         => v_body,
      p_notification_type => 'handoff_ready',
      p_link_url          => '/applications/projects',
      p_source            => 'handoff_complete_run'
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handoff_ready notification failed for user % (run %): %', v_triggered_by, p_run_id, SQLERRM;
  END;

  RETURN true;
END $$;

REVOKE ALL ON FUNCTION public.handoff_complete_run(uuid, text, integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handoff_complete_run(uuid, text, integer) TO service_role;
