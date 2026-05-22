
ALTER TABLE public.email_send_state
  ADD COLUMN IF NOT EXISTS per_recipient_bulk_window_hours integer NOT NULL DEFAULT 24,
  ADD COLUMN IF NOT EXISTS per_recipient_bulk_max integer NOT NULL DEFAULT 1;

CREATE OR REPLACE FUNCTION public.replay_frequency_capped(
  p_template_name text,
  p_since timestamptz DEFAULT (now() - interval '7 days')
)
RETURNS TABLE(replayed_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Admin role required';
  END IF;

  WITH capped AS (
    SELECT DISTINCT ON (recipient_email) recipient_email, message_id, created_at
    FROM public.email_send_log
    WHERE status = 'frequency_capped'
      AND template_name = p_template_name
      AND created_at >= p_since
      AND NOT EXISTS (
        SELECT 1 FROM public.email_send_log later
        WHERE later.recipient_email = email_send_log.recipient_email
          AND later.template_name = p_template_name
          AND later.status = 'sent'
          AND later.created_at > email_send_log.created_at
      )
    ORDER BY recipient_email, created_at DESC
  )
  INSERT INTO public.email_send_log (message_id, template_name, recipient_email, status, error_message, metadata)
  SELECT
    message_id,
    p_template_name,
    recipient_email,
    'replay_requested',
    'Queued for admin replay',
    jsonb_build_object('admin_id', auth.uid(), 'replayed_at', now())
  FROM capped
  RETURNING 1 INTO v_count;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  INSERT INTO public.audit_log (actor_user_id, action, target_type, metadata)
  VALUES (
    auth.uid(),
    'email.frequency_capped.replay',
    p_template_name,
    jsonb_build_object('count', v_count, 'since', p_since)
  );

  RETURN QUERY SELECT v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.replay_frequency_capped(text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replay_frequency_capped(text, timestamptz) TO authenticated;
