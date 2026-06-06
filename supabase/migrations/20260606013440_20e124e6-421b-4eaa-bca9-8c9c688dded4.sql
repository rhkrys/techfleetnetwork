CREATE OR REPLACE FUNCTION public.get_email_send_latest_status(p_hours integer DEFAULT 24)
RETURNS TABLE (
  out_message_id text,
  out_template_name text,
  out_recipient_email text,
  out_status text,
  out_error_message text,
  out_last_event_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  SELECT DISTINCT ON (l.message_id)
    l.message_id,
    l.template_name,
    l.recipient_email,
    l.status,
    l.error_message,
    l.created_at
  FROM public.email_send_log l
  WHERE l.created_at > now() - make_interval(hours => GREATEST(p_hours, 1))
    AND l.message_id IS NOT NULL
  ORDER BY l.message_id, l.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_email_send_latest_status(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_email_send_latest_status(integer) TO authenticated, service_role;