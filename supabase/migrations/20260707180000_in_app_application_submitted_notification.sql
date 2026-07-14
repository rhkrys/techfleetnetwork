-- Add an in-app "application submitted" notification alongside the existing
-- confirmation-email outbox enqueue.
--
-- Before: submitting a general/project application only enqueued a confirmation
-- EMAIL (application_confirmation_outbox) and — from the client — fired a
-- Discord ping. There was NO in-app notification, so a member saw nothing in
-- their notification center after applying. (The client also only invoked the
-- confirmation email when an application row already existed, so a one-shot
-- submit could miss even the email.)
--
-- Fix: extend the existing fn_enqueue_application_confirmation trigger function
-- so the SAME first-transition-to-completed event that enqueues the email also
-- creates an in-app notification via safe_create_notification (which has its own
-- outbox + retry + DLQ). Server-side => reliable and independent of the client.
--
-- Idempotent: the notification is created ONLY when the outbox INSERT actually
-- inserts a new row (ON CONFLICT DO NOTHING RETURNING), so re-fires never
-- duplicate it. Best-effort: wrapped so a notification failure can never roll
-- back the member's application submit. Triggers are unchanged (CREATE OR
-- REPLACE keeps them bound to this function).

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
  v_outbox_id uuid;
  v_project_name text;
  v_title text;
  v_body text;
  v_link text;
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
  ON CONFLICT (kind, application_id) DO NOTHING
  RETURNING id INTO v_outbox_id;

  -- In-app notification — only on first enqueue (idempotent). Best-effort:
  -- a failure here must never roll back the application submit.
  IF v_outbox_id IS NOT NULL THEN
    BEGIN
      IF v_kind = 'project' THEN
        SELECT NULLIF(
                 concat_ws(' — ', NULLIF(c.name, ''), NULLIF(pr.friendly_name, '')),
                 '')
          INTO v_project_name
        FROM public.projects pr
        LEFT JOIN public.clients c ON c.id = pr.client_id
        WHERE pr.id = v_project_id;

        v_title := 'Application submitted' || COALESCE(' — ' || v_project_name, '');
        v_body  := '<p>Your project application'
                   || COALESCE(' for <strong>' || v_project_name || '</strong>', '')
                   || ' was submitted. We''ll update you here and by email as the coordinator reviews it.</p>';
        v_link  := '/applications/projects';
      ELSE
        v_title := 'General Application received';
        v_body  := '<p>Your General Application was submitted. Browse the open projects and apply whenever you''re ready.</p>';
        v_link  := '/applications';
      END IF;

      PERFORM public.safe_create_notification(
        p_user_id           => NEW.user_id,
        p_title             => v_title,
        p_body_html         => v_body,
        p_notification_type => 'application_submitted',
        p_link_url          => v_link,
        p_source            => 'fn_enqueue_application_confirmation'
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'in-app application-submitted notification failed for user % (kind %): %',
        NEW.user_id, v_kind, SQLERRM;
    END;
  END IF;

  RETURN NEW;
END;
$$;
