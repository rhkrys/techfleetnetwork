
-- Remove tables from postgres_changes publication; replace with RLS-authorized
-- Realtime Broadcast topics so no subscriber can ever receive another user's row.

ALTER PUBLICATION supabase_realtime DROP TABLE public.project_applications;
ALTER PUBLICATION supabase_realtime DROP TABLE public.refactor_kpi_daily;

-- Broadcast project_applications changes only to the owning user's topic.
CREATE OR REPLACE FUNCTION public.broadcast_project_application_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_user uuid;
  payload jsonb;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_user := OLD.user_id;
    payload := jsonb_build_object('op', 'DELETE', 'id', OLD.id);
  ELSE
    target_user := NEW.user_id;
    payload := jsonb_build_object('op', TG_OP, 'id', NEW.id, 'status', NEW.applicant_status);
  END IF;

  IF target_user IS NOT NULL THEN
    PERFORM realtime.send(
      payload,
      'project_applications_change',
      'user:' || target_user::text || ':project-applications',
      true  -- private: requires realtime.messages RLS to authorize subscriber
    );
  END IF;

  -- If user_id changed on UPDATE, also notify the previous owner.
  IF TG_OP = 'UPDATE' AND OLD.user_id IS DISTINCT FROM NEW.user_id AND OLD.user_id IS NOT NULL THEN
    PERFORM realtime.send(
      jsonb_build_object('op', 'UPDATE', 'id', NEW.id, 'status', NEW.applicant_status),
      'project_applications_change',
      'user:' || OLD.user_id::text || ':project-applications',
      true
    );
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_broadcast_project_application_change ON public.project_applications;
CREATE TRIGGER trg_broadcast_project_application_change
AFTER INSERT OR UPDATE OR DELETE ON public.project_applications
FOR EACH ROW EXECUTE FUNCTION public.broadcast_project_application_change();

-- Broadcast refactor_kpi_daily changes only to the admin-scoped topic.
CREATE OR REPLACE FUNCTION public.broadcast_refactor_kpi_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM realtime.send(
    jsonb_build_object('op', TG_OP, 'metric_key', COALESCE(NEW.metric_key, OLD.metric_key)),
    'refactor_kpi_change',
    'admin:refactor-kpis',
    true
  );
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_broadcast_refactor_kpi_change ON public.refactor_kpi_daily;
CREATE TRIGGER trg_broadcast_refactor_kpi_change
AFTER INSERT OR UPDATE OR DELETE ON public.refactor_kpi_daily
FOR EACH ROW EXECUTE FUNCTION public.broadcast_refactor_kpi_change();
