
-- 1) STRENGTHEN general_applications invariant: any completed_at => status='completed'
CREATE OR REPLACE FUNCTION public.general_applications_protect_completed_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Once completed_at has ever been set, status is locked to 'completed' and
  -- completed_at cannot be cleared. Any concurrent autosave/draft write is
  -- neutralized at the database layer so client-side races can never corrupt
  -- a submitted application back to draft.
  IF OLD.completed_at IS NOT NULL THEN
    NEW.completed_at := OLD.completed_at;
    NEW.status := 'completed';
  ELSIF NEW.completed_at IS NOT NULL THEN
    NEW.status := 'completed';
  END IF;
  RETURN NEW;
END;
$$;

-- 2) ADD identical invariant to project_applications
CREATE OR REPLACE FUNCTION public.project_applications_protect_completed_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.completed_at IS NOT NULL THEN
    NEW.completed_at := OLD.completed_at;
    NEW.status := 'completed';
  ELSIF NEW.completed_at IS NOT NULL THEN
    NEW.status := 'completed';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_project_applications_protect_completed_status
  ON public.project_applications;

CREATE TRIGGER trg_project_applications_protect_completed_status
BEFORE UPDATE ON public.project_applications
FOR EACH ROW
EXECUTE FUNCTION public.project_applications_protect_completed_status();

-- 3) Backfill any legacy drift in both tables
UPDATE public.general_applications
SET status = 'completed'
WHERE completed_at IS NOT NULL AND status <> 'completed';

UPDATE public.project_applications
SET status = 'completed'
WHERE completed_at IS NOT NULL AND status <> 'completed';

-- 4) Confirmation-email outbox: one row per submitted application, drained by
--    the send-application-confirmation edge function and the hourly sweeper.
CREATE TABLE IF NOT EXISTS public.application_confirmation_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('general','project')),
  application_id uuid NOT NULL,
  user_id uuid NOT NULL,
  recipient_email text,
  project_id uuid,
  enqueued_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  UNIQUE (kind, application_id)
);

GRANT SELECT ON public.application_confirmation_outbox TO authenticated;
GRANT ALL ON public.application_confirmation_outbox TO service_role;

ALTER TABLE public.application_confirmation_outbox ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view their own confirmation outbox rows"
  ON public.application_confirmation_outbox FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all confirmation outbox rows"
  ON public.application_confirmation_outbox FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS idx_app_conf_outbox_pending
  ON public.application_confirmation_outbox (enqueued_at)
  WHERE sent_at IS NULL;

-- 5) Trigger: enqueue a confirmation row when an application transitions to completed
CREATE OR REPLACE FUNCTION public.fn_enqueue_application_confirmation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_kind text;
  v_email text;
  v_project_id uuid;
BEGIN
  -- Only enqueue on the first transition to completed_at
  IF NEW.completed_at IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.completed_at IS NOT NULL THEN RETURN NEW; END IF;

  IF TG_TABLE_NAME = 'general_applications' THEN
    v_kind := 'general';
    v_email := NEW.email;
    v_project_id := NULL;
  ELSIF TG_TABLE_NAME = 'project_applications' THEN
    v_kind := 'project';
    v_email := NULL;
    v_project_id := NEW.project_id;
  ELSE
    RETURN NEW;
  END IF;

  IF v_email IS NULL OR v_email = '' THEN
    SELECT p.email INTO v_email
    FROM public.profiles p
    WHERE p.user_id = NEW.user_id;
  END IF;

  INSERT INTO public.application_confirmation_outbox
    (kind, application_id, user_id, recipient_email, project_id)
  VALUES (v_kind, NEW.id, NEW.user_id, v_email, v_project_id)
  ON CONFLICT (kind, application_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enqueue_general_app_confirmation
  ON public.general_applications;
CREATE TRIGGER trg_enqueue_general_app_confirmation
AFTER INSERT OR UPDATE OF completed_at ON public.general_applications
FOR EACH ROW
EXECUTE FUNCTION public.fn_enqueue_application_confirmation();

DROP TRIGGER IF EXISTS trg_enqueue_project_app_confirmation
  ON public.project_applications;
CREATE TRIGGER trg_enqueue_project_app_confirmation
AFTER INSERT OR UPDATE OF completed_at ON public.project_applications
FOR EACH ROW
EXECUTE FUNCTION public.fn_enqueue_application_confirmation();

-- 6) Seed outbox for any already-completed apps that don't have a row yet
INSERT INTO public.application_confirmation_outbox (kind, application_id, user_id, recipient_email, project_id)
SELECT 'general', ga.id, ga.user_id,
       COALESCE(NULLIF(ga.email, ''), (SELECT email FROM public.profiles p WHERE p.user_id = ga.user_id)),
       NULL
FROM public.general_applications ga
WHERE ga.completed_at IS NOT NULL
ON CONFLICT (kind, application_id) DO NOTHING;

INSERT INTO public.application_confirmation_outbox (kind, application_id, user_id, recipient_email, project_id)
SELECT 'project', pa.id, pa.user_id,
       (SELECT email FROM public.profiles p WHERE p.user_id = pa.user_id),
       pa.project_id
FROM public.project_applications pa
WHERE pa.completed_at IS NOT NULL
ON CONFLICT (kind, application_id) DO NOTHING;

-- 7) Mark the historical backlog (anything completed before this migration) as
--    already sent so the sweeper doesn't blast a year of confirmation emails to
--    every existing member. New submissions from now on get a confirmation.
UPDATE public.application_confirmation_outbox
SET sent_at = now(), last_error = 'historical_backfill_skipped'
WHERE sent_at IS NULL
  AND enqueued_at <= now();
