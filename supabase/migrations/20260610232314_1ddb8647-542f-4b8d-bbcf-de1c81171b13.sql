CREATE OR REPLACE FUNCTION public.invoke_email_dispatcher_cron()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, extensions, pg_net
AS $$
DECLARE v_url TEXT; v_key TEXT;
BEGIN
  BEGIN
    SELECT decrypted_secret INTO v_url
      FROM vault.decrypted_secrets WHERE name = 'project_url' LIMIT 1;
    SELECT decrypted_secret INTO v_key
      FROM vault.decrypted_secrets
      WHERE name IN ('email_queue_service_role_key','service_role_key',
                     'EMAIL_QUEUE_SERVICE_ROLE_KEY','SERVICE_ROLE_KEY')
      ORDER BY CASE name
        WHEN 'email_queue_service_role_key' THEN 1
        WHEN 'EMAIL_QUEUE_SERVICE_ROLE_KEY' THEN 2
        WHEN 'service_role_key' THEN 3 ELSE 4 END
      LIMIT 1;
  EXCEPTION WHEN OTHERS THEN RETURN; END;
  IF v_url IS NULL OR v_key IS NULL THEN RETURN; END IF;

  PERFORM net.http_post(
    url     := rtrim(v_url,'/') || '/functions/v1/email-dispatcher',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || v_key),
    body    := jsonb_build_object('source','cron','at',now()),
    timeout_milliseconds := 5000
  );
END;$$;

REVOKE ALL ON FUNCTION public.invoke_email_dispatcher_cron() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invoke_email_dispatcher_cron() TO service_role;

DO $$
DECLARE v_jobid bigint;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'email-dispatcher-v2';
  IF v_jobid IS NOT NULL THEN PERFORM cron.unschedule(v_jobid); END IF;
  PERFORM cron.schedule('email-dispatcher-v2','* * * * *',
    $cron$ SELECT public.invoke_email_dispatcher_cron(); $cron$);

  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'email-v2-daily-rollup';
  IF v_jobid IS NOT NULL THEN PERFORM cron.unschedule(v_jobid); END IF;
  PERFORM cron.schedule('email-v2-daily-rollup','15 3 * * *',
    $cron$ SELECT public.email_v2_daily_rollup(((now() AT TIME ZONE 'utc')::date - 1)); $cron$);
END$$;

INSERT INTO public.bdd_scenarios (scenario_id, feature_area, feature_area_number, title, gherkin, status, test_type) VALUES
('EMAIL-V2-013','Email Subsystem v2',2,'Dispatcher cron drains the outbox every minute',
'Feature: Email Subsystem v2 Dispatcher Cron
  Scenario: Pending row is picked up within 60s without NOTIFY
    Given a row exists in email_outbox with status=pending and next_attempt_at<=now()
    And the trigger-driven NOTIFY path is unavailable (vault temporarily missing)
    When the pg_cron job ''email-dispatcher-v2'' fires
    Then [Code] public.invoke_email_dispatcher_cron() POSTs to /functions/v1/email-dispatcher with a service-role bearer
    And [DB] the row transitions pending -> sending -> sent within one cron tick on the happy path
    And [UI] the Email Control Center reflects the new sent count on next refresh',
'implemented','none'),
('EMAIL-V2-014','Email Subsystem v2',2,'Daily rollup writes ops_metrics for yesterday',
'Feature: Email Subsystem v2 Daily Rollup
  Scenario: 03:15 UTC cron snapshots yesterday into ops_metrics
    Given email_outbox has rows for the previous UTC day across lanes
    When pg_cron job ''email-v2-daily-rollup'' executes
    Then [Code] public.email_v2_daily_rollup(yesterday) runs once with no error
    And [DB] ops_metrics gains daily rows keyed by lane for sent/dlq/expired counts
    And [UI] the Email Control Center trend chart loads yesterday''s totals without a manual snapshot',
'implemented','none')
ON CONFLICT (scenario_id) DO UPDATE
  SET gherkin = EXCLUDED.gherkin, title = EXCLUDED.title, status = EXCLUDED.status, updated_at = now();