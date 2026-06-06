
-- AUTH-RESET-SESSION-004: Latest-status email health helpers.
-- Append-only email_send_log rows ("pending" never deleted) caused operators
-- to misread healthy recoveries as failures during the password-reset incident.
-- This migration adds a deduped view + RPCs that always return the terminal
-- status per message_id, and a recovery-email assertion for System Health.

CREATE OR REPLACE VIEW public.email_send_log_latest AS
SELECT DISTINCT ON (message_id)
  id,
  message_id,
  template_name,
  recipient_email,
  status,
  error_message,
  metadata,
  created_at
FROM public.email_send_log
WHERE message_id IS NOT NULL
ORDER BY message_id, created_at DESC;

REVOKE ALL ON public.email_send_log_latest FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.email_send_log_latest TO service_role;

CREATE OR REPLACE FUNCTION public.get_email_send_latest(
  p_limit integer DEFAULT 100,
  p_since timestamptz DEFAULT now() - interval '7 days',
  p_template text DEFAULT NULL,
  p_status text DEFAULT NULL
) RETURNS TABLE (
  message_id text,
  template_name text,
  recipient_email text,
  status text,
  error_message text,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT message_id, template_name, recipient_email, status, error_message, created_at
  FROM public.email_send_log_latest
  WHERE created_at >= p_since
    AND (p_template IS NULL OR template_name = p_template)
    AND (p_status IS NULL OR status = p_status)
    AND public.has_role(auth.uid(), 'admin'::public.app_role)
  ORDER BY created_at DESC
  LIMIT GREATEST(1, LEAST(p_limit, 500))
$$;

REVOKE ALL ON FUNCTION public.get_email_send_latest(integer, timestamptz, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_email_send_latest(integer, timestamptz, text, text) TO authenticated, service_role;

-- Recovery-specific health: aged recovery emails stuck in pgmq queue or with
-- terminal status of dlq/failed/bounced over the window. Append-only "pending"
-- rows are intentionally IGNORED — they are not signal.
CREATE OR REPLACE FUNCTION public.get_recovery_email_health(
  p_window_minutes integer DEFAULT 60
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_window interval := make_interval(mins => GREATEST(1, LEAST(p_window_minutes, 1440)));
  v_terminal_failures integer;
  v_sent integer;
  v_total integer;
  v_last_sent timestamptz;
  v_last_failure timestamptz;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role)
     AND auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT
    count(*) FILTER (WHERE status IN ('dlq','failed','bounced')),
    count(*) FILTER (WHERE status = 'sent'),
    count(*),
    max(created_at) FILTER (WHERE status = 'sent'),
    max(created_at) FILTER (WHERE status IN ('dlq','failed','bounced'))
  INTO v_terminal_failures, v_sent, v_total, v_last_sent, v_last_failure
  FROM public.email_send_log_latest
  WHERE template_name = 'recovery'
    AND created_at >= now() - v_window;

  RETURN jsonb_build_object(
    'window_minutes', p_window_minutes,
    'total', COALESCE(v_total, 0),
    'sent', COALESCE(v_sent, 0),
    'terminal_failures', COALESCE(v_terminal_failures, 0),
    'last_sent_at', v_last_sent,
    'last_failure_at', v_last_failure,
    'healthy', COALESCE(v_terminal_failures, 0) = 0,
    'note', 'pending rows are append-only history and are intentionally excluded'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_recovery_email_health(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_recovery_email_health(integer) TO authenticated, service_role;

COMMENT ON VIEW public.email_send_log_latest IS
  'AUTH-RESET-SESSION-004: terminal status per message_id; do not read raw email_send_log for health.';
COMMENT ON FUNCTION public.get_recovery_email_health(integer) IS
  'AUTH-RESET-SESSION-004: recovery email health; ignores append-only pending rows.';
