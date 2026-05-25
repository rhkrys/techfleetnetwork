
-- Phase 1: Grant EXECUTE to authenticated on the class-workflow RPCs.
-- These are SECURITY DEFINER and enforce owner/admin checks internally.
GRANT EXECUTE ON FUNCTION public.submit_class_for_review(uuid, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_and_publish_class(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_class_changes(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.archive_class(uuid, text) TO authenticated;

-- Phase 2: Expand the in-app notification trigger to notify BOTH sides on every transition,
-- and surface failures via RAISE LOG instead of silent swallow.
CREATE OR REPLACE FUNCTION public.trg_notify_class_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_link        text;
  v_admin_link  text;
  v_admin       record;
  v_reason      text;
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  v_link       := '/teach/classes/' || NEW.id::text;
  v_admin_link := '/admin/classes';

  -- draft -> pending_review
  IF OLD.status = 'draft' AND NEW.status = 'pending_review' THEN
    -- Notify all admins
    FOR v_admin IN SELECT user_id FROM public.user_roles WHERE role = 'admin' LOOP
      INSERT INTO public.notifications (user_id, title, body_html, notification_type, link_url)
      VALUES (
        v_admin.user_id,
        'Class submitted for review',
        '<p>A teacher submitted "<strong>' || NEW.title || '</strong>" for review.</p>',
        'class_submitted_for_review',
        v_admin_link
      );
    END LOOP;
    -- Notify the teacher (confirmation)
    INSERT INTO public.notifications (user_id, title, body_html, notification_type, link_url)
    VALUES (
      NEW.owner_user_id,
      'Your class is being reviewed',
      '<p>"<strong>' || NEW.title || '</strong>" was submitted for review. We''ll let you know once an admin takes action.</p>',
      'class_submitted_confirmation',
      v_link
    );

  -- pending_review -> published
  ELSIF OLD.status = 'pending_review' AND NEW.status = 'published' THEN
    INSERT INTO public.notifications (user_id, title, body_html, notification_type, link_url)
    VALUES (
      NEW.owner_user_id,
      'Your class was approved',
      '<p>"<strong>' || NEW.title || '</strong>" has been published.</p>',
      'class_approved',
      v_link
    );
    FOR v_admin IN SELECT user_id FROM public.user_roles WHERE role = 'admin' LOOP
      INSERT INTO public.notifications (user_id, title, body_html, notification_type, link_url)
      VALUES (
        v_admin.user_id,
        'Class approved',
        '<p>"<strong>' || NEW.title || '</strong>" was approved and published.</p>',
        'class_approved_admin',
        v_admin_link
      );
    END LOOP;

  -- pending_review -> draft (changes requested)
  ELSIF OLD.status = 'pending_review' AND NEW.status = 'draft' THEN
    SELECT reason INTO v_reason
      FROM public.class_audit
      WHERE class_id = NEW.id AND action = 'request_changes'
      ORDER BY created_at DESC
      LIMIT 1;

    INSERT INTO public.notifications (user_id, title, body_html, notification_type, link_url)
    VALUES (
      NEW.owner_user_id,
      'Changes requested on your class',
      '<p>An admin requested changes on "<strong>' || NEW.title || '</strong>".</p>'
        || COALESCE('<blockquote>' || v_reason || '</blockquote>', ''),
      'class_changes_requested',
      v_link
    );
    FOR v_admin IN SELECT user_id FROM public.user_roles WHERE role = 'admin' LOOP
      INSERT INTO public.notifications (user_id, title, body_html, notification_type, link_url)
      VALUES (
        v_admin.user_id,
        'Changes requested',
        '<p>Changes were requested on "<strong>' || NEW.title || '</strong>".</p>',
        'class_changes_requested_admin',
        v_admin_link
      );
    END LOOP;

  -- * -> archived
  ELSIF NEW.status = 'archived' AND OLD.status <> 'archived' THEN
    INSERT INTO public.notifications (user_id, title, body_html, notification_type, link_url)
    VALUES (
      NEW.owner_user_id,
      'Your class was archived',
      '<p>"<strong>' || NEW.title || '</strong>" has been archived.</p>',
      'class_archived',
      v_link
    );
    FOR v_admin IN SELECT user_id FROM public.user_roles WHERE role = 'admin' LOOP
      INSERT INTO public.notifications (user_id, title, body_html, notification_type, link_url)
      VALUES (
        v_admin.user_id,
        'Class archived',
        '<p>"<strong>' || NEW.title || '</strong>" was archived.</p>',
        'class_archived_admin',
        v_admin_link
      );
    END LOOP;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'trg_notify_class_status_change failed for class %: % (%)', NEW.id, SQLERRM, SQLSTATE;
  RETURN NEW;
END;
$$;

-- Phase 3: Recipient lookup RPCs for client-side email dispatch.
CREATE OR REPLACE FUNCTION public.get_class_email_recipients(p_class_id uuid)
RETURNS TABLE (
  owner_user_id uuid,
  owner_email   text,
  owner_name    text,
  class_title   text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only the class owner or an admin can resolve recipients.
  IF NOT EXISTS (
    SELECT 1 FROM public.classes c
    WHERE c.id = p_class_id
      AND (c.owner_user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  ) THEN
    RAISE EXCEPTION 'not allowed';
  END IF;

  RETURN QUERY
  SELECT
    c.owner_user_id,
    p.email,
    NULLIF(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''),
    c.title
  FROM public.classes c
  LEFT JOIN public.profiles p ON p.user_id = c.owner_user_id
  WHERE c.id = p_class_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_admin_email_recipients()
RETURNS TABLE (
  user_id    uuid,
  email      text,
  full_name  text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Restrict to admins and teachers (teachers need this when submitting).
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'teacher')) THEN
    RAISE EXCEPTION 'not allowed';
  END IF;

  RETURN QUERY
  SELECT
    ur.user_id,
    p.email,
    NULLIF(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), '')
  FROM public.user_roles ur
  LEFT JOIN public.profiles p ON p.user_id = ur.user_id
  WHERE ur.role = 'admin' AND p.email IS NOT NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_class_email_recipients(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_admin_email_recipients() TO authenticated;
