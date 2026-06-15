CREATE OR REPLACE FUNCTION public.check_auth_email_delivery_contract()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_window_minutes int := 15;
  v_forgot_attempts int;
  v_signup_attempts int;
  v_recovery_emails int;
  v_signup_emails int;
  v_breach boolean := false;
  v_payload jsonb;
BEGIN
  SELECT COUNT(*) INTO v_forgot_attempts
  FROM public.ops_events
  WHERE kind = 'auth_engine.forgot_accepted'
    AND created_at > now() - (v_window_minutes || ' minutes')::interval;

  SELECT COUNT(*) INTO v_signup_attempts
  FROM public.ops_events
  WHERE kind = 'auth_engine.sign_up_succeeded'
    AND created_at > now() - (v_window_minutes || ' minutes')::interval;

  SELECT COUNT(*) INTO v_recovery_emails
  FROM public.email_send_log
  WHERE template_name = 'recovery'
    AND created_at > now() - (v_window_minutes || ' minutes')::interval;

  SELECT COUNT(*) INTO v_signup_emails
  FROM public.email_send_log
  WHERE template_name = 'signup'
    AND created_at > now() - (v_window_minutes || ' minutes')::interval;

  v_breach := (v_forgot_attempts > 0 AND v_recovery_emails = 0)
           OR (v_signup_attempts > 0 AND v_signup_emails = 0);

  v_payload := jsonb_build_object(
    'window_minutes', v_window_minutes,
    'forgot_attempts', v_forgot_attempts,
    'recovery_emails', v_recovery_emails,
    'signup_attempts', v_signup_attempts,
    'signup_emails', v_signup_emails,
    'breach', v_breach
  );

  IF v_breach THEN
    PERFORM public.record_event(
      'ops_events',
      'email_pipeline.auth_delivery_contract_breached',
      NULL,
      v_payload,
      'error',
      'email_send_log',
      NULL
    );
  END IF;

  RETURN v_payload;
END;
$$;

REVOKE ALL ON FUNCTION public.check_auth_email_delivery_contract() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_auth_email_delivery_contract() TO service_role;

-- Schedule every 5 minutes (drop existing schedule with same name first, if any).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auth-email-delivery-contract') THEN
    PERFORM cron.unschedule('auth-email-delivery-contract');
  END IF;
  PERFORM cron.schedule(
    'auth-email-delivery-contract',
    '*/5 * * * *',
    $cron$ SELECT public.check_auth_email_delivery_contract(); $cron$
  );
END $$;

INSERT INTO public.bdd_scenarios (scenario_id, feature_area, feature_area_number, title, gherkin, status) VALUES
('AUTH-ARCH-CUTOVER-019','auth/architecture',1100,'Auth email delivery contract detects silent recovery email failures',
 E'Given a member submits the forgot-password form\nWhen the engine emits auth_engine.forgot_accepted but the auth-email-hook never writes an email_send_log row\nThen [DB] check_auth_email_delivery_contract() returns breach=true within 15 minutes\nAnd [DB] an ops_events row of kind email_pipeline.auth_delivery_contract_breached is written at severity=error\nAnd [UI] no anti-enumeration copy changes for the member','implemented'),
('AUTH-ARCH-CUTOVER-020','auth/architecture',1100,'Delivery-contract prober is scheduled every 5 minutes',
 E'Given the cutover phase 4 cron job\nWhen pg_cron is inspected\nThen [DB] cron.job contains jobname=auth-email-delivery-contract with schedule */5 * * * *\nAnd [Code] the job invokes public.check_auth_email_delivery_contract()','implemented'),
('AUTH-ARCH-CUTOVER-021','auth/architecture',1100,'Delivery contract stays silent when attempts and email rows match',
 E'Given the auth-email-hook is healthy\nWhen N forgot/signup attempts produce N or more email_send_log rows in the window\nThen [DB] check_auth_email_delivery_contract() returns breach=false\nAnd [DB] no ops_events row is recorded\nAnd [UI] no triage noise reaches admins','implemented')
ON CONFLICT (scenario_id) DO UPDATE SET status=EXCLUDED.status, gherkin=EXCLUDED.gherkin, title=EXCLUDED.title, updated_at=now();