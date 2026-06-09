
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'app-confirmation-sweeper') THEN
    PERFORM cron.unschedule('app-confirmation-sweeper');
  END IF;
END $$;

SELECT cron.schedule(
  'app-confirmation-sweeper',
  '*/5 * * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://iqsjhrhsjlgjiaedzmtz.supabase.co/functions/v1/send-application-confirmation',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body := jsonb_build_object('source', 'cron', 'scheduled_at', now())
  ) AS request_id;
  $cron$
);

INSERT INTO public.bdd_scenarios (scenario_id, feature_area, feature_area_number, title, gherkin, test_type, status)
VALUES
  ('APP-SUBMIT-001', 'applications', 99, 'Late autosave cannot revert a submitted general application',
   'Given a member has just submitted their general application\nAnd a late autosave write arrives with status=draft\nWhen the autosave update runs\nThen [DB] the row status remains completed\nAnd [DB] completed_at is unchanged\nAnd [UI] the Applications page still shows Completed with the original submission date\nAnd [Code] no client retry path can ever set status=draft on a row with completed_at',
   'manual', 'implemented'),
  ('APP-SUBMIT-002', 'applications', 99, 'Late autosave cannot revert a submitted project application',
   'Given a member has just submitted a project application\nAnd a late autosave or step-nav write arrives without status=completed\nWhen the autosave update runs\nThen [DB] the project_applications row status remains completed\nAnd [DB] completed_at is preserved\nAnd [UI] My Project Applications still shows the project as Submitted\nAnd [UI] the Applications page badge count includes this project',
   'manual', 'implemented'),
  ('APP-SUBMIT-003', 'applications', 99, 'Submitting a general application queues exactly one confirmation email',
   'Given a member submits their general application\nWhen the submit succeeds\nThen [DB] application_confirmation_outbox has one row for kind=general and the application id\nAnd [Code] the client invokes send-application-confirmation with the application id\nAnd [DB] the outbox row sent_at is populated within 5 minutes\nAnd [UI] the member receives an email titled Your Tech Fleet general application is in\nAnd [DB] re-running the sweeper does not send a second email (idempotency key app-confirm:general:<id>)',
   'manual', 'implemented'),
  ('APP-SUBMIT-004', 'applications', 99, 'Submitting a project application queues exactly one confirmation email',
   'Given a member submits a project application\nWhen the submit succeeds\nThen [DB] application_confirmation_outbox has one row for kind=project and the application id\nAnd [DB] the outbox row sent_at is populated within 5 minutes\nAnd [UI] the member receives an email naming the project they applied to\nAnd [DB] re-submitting the same project application does not enqueue a duplicate outbox row',
   'manual', 'implemented'),
  ('APP-SUBMIT-005', 'applications', 99, 'Profile and Applications page count reflect completion via timestamp OR status',
   'Given a member has any project_applications row with completed_at set\nWhen the Applications page renders\nThen [UI] the project applications badge counts that row as Submitted\nAnd [Code] the count uses status=completed OR completed_at IS NOT NULL\nAnd [UI] no member ever sees 0 apps while having a completed_at timestamp',
   'manual', 'implemented')
ON CONFLICT (scenario_id) DO UPDATE
  SET gherkin = EXCLUDED.gherkin,
      status = EXCLUDED.status,
      title = EXCLUDED.title;
