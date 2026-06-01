DO $$
DECLARE
  keep_job_id integer;
  legacy_job_id integer;
BEGIN
  SELECT jobid INTO keep_job_id
  FROM cron.job
  WHERE jobname = 'prewarm-ugc-worker-every-30s'
  LIMIT 1;

  SELECT jobid INTO legacy_job_id
  FROM cron.job
  WHERE jobname = 'prewarm-ugc-worker-30s'
  LIMIT 1;

  IF legacy_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(legacy_job_id);
  END IF;

  IF keep_job_id IS NOT NULL THEN
    PERFORM cron.alter_job(
      job_id := keep_job_id,
      schedule := '30 seconds',
      command := $cmd$
        SELECT net.http_post(
          url := 'https://iqsjhrhsjlgjiaedzmtz.supabase.co/functions/v1/prewarm-ugc-worker',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || COALESCE(
              (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_service_role_key' LIMIT 1),
              (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1),
              (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key' LIMIT 1)
            )
          ),
          body := jsonb_build_object('source', 'cron')
        );
      $cmd$
    );
  ELSE
    PERFORM cron.schedule(
      'prewarm-ugc-worker-every-30s',
      '30 seconds',
      $cmd$
        SELECT net.http_post(
          url := 'https://iqsjhrhsjlgjiaedzmtz.supabase.co/functions/v1/prewarm-ugc-worker',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || COALESCE(
              (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_service_role_key' LIMIT 1),
              (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1),
              (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key' LIMIT 1)
            )
          ),
          body := jsonb_build_object('source', 'cron')
        );
      $cmd$
    );
  END IF;
END $$;

INSERT INTO public.bdd_scenarios (
  feature_area,
  feature_area_number,
  scenario_id,
  title,
  gherkin,
  status,
  test_type,
  test_file,
  notes
) VALUES (
  'UGC translation worker reliability',
  7031,
  'I18N-UGC-CRON-001',
  'Scheduled translation worker uses service authentication',
  $gherkin$Feature: Scheduled translation worker reliability
  Scenario: Cron drains translations without unauthorized edge failures
    Given pending ugc_translation_jobs exist
    And the prewarm-ugc-worker schedule is active
    When the schedule invokes prewarm-ugc-worker
    Then [UI] System Health Translations does not show a repeated Edge Function request failure for prewarm-ugc-worker
    And [DB] exactly one active cron job named prewarm-ugc-worker-every-30s calls prewarm-ugc-worker with an Authorization bearer header
    And [DB] no active cron job named prewarm-ugc-worker-30s remains
    And [Code] prewarm-ugc-worker accepts only the service-role bearer token and rejects public or missing tokens with a logged 401 envelope
$gherkin$,
  'implemented',
  'e2e',
  'supabase/migrations/20260601_fix_prewarm_ugc_cron_auth.sql',
  'incident:Failed_to_send_a_request_to_the_Edge_Function; root cause was public-key cron invocation of service-role-only prewarm-ugc-worker'
) ON CONFLICT (scenario_id) DO UPDATE SET
  title = EXCLUDED.title,
  gherkin = EXCLUDED.gherkin,
  status = EXCLUDED.status,
  test_type = EXCLUDED.test_type,
  test_file = EXCLUDED.test_file,
  notes = EXCLUDED.notes,
  updated_at = now();