-- Instant-dispatch trigger for email_outbox v2 (parallels the legacy pgmq NOTIFY pattern).
CREATE OR REPLACE FUNCTION public.notify_email_outbox_v2()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, extensions, pg_net
AS $$
BEGIN
  -- Only ping for actionable rows; status defaults to 'pending'.
  IF NEW.status IS DISTINCT FROM 'pending' THEN RETURN NEW; END IF;
  BEGIN
    PERFORM public.invoke_email_dispatcher_cron();
  EXCEPTION WHEN OTHERS THEN
    -- Never let the dispatch ping fail an enqueue; cron is the safety net.
    NULL;
  END;
  RETURN NEW;
END;$$;

REVOKE ALL ON FUNCTION public.notify_email_outbox_v2() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_notify_email_outbox_v2 ON public.email_outbox;
CREATE TRIGGER trg_notify_email_outbox_v2
AFTER INSERT ON public.email_outbox
FOR EACH ROW EXECUTE FUNCTION public.notify_email_outbox_v2();

INSERT INTO public.bdd_scenarios (scenario_id, feature_area, feature_area_number, title, gherkin, status, test_type) VALUES
('EMAIL-V2-015','Email Subsystem v2',2,'Outbox INSERT pings dispatcher within sub-second latency',
'Feature: Email Subsystem v2 Instant Dispatch
  Scenario: New pending row triggers dispatcher without waiting for cron
    Given the email-dispatcher edge function is deployed and vault holds the service-role key
    When EnqueueEmail inserts a row into public.email_outbox with status=pending
    Then [Code] trigger trg_notify_email_outbox_v2 fires AFTER INSERT and calls public.invoke_email_dispatcher_cron()
    And [DB] net.http_post is issued to /functions/v1/email-dispatcher with a service-role bearer
    And [UI] the Email Control Center shows the row transition pending -> sent within a single page refresh under normal load
  Scenario: Vault key missing falls back to cron safety net
    Given the vault secret email_queue_service_role_key is temporarily unavailable
    When EnqueueEmail inserts a row into public.email_outbox
    Then [Code] notify_email_outbox_v2 swallows the error and returns NEW (enqueue never fails)
    And [DB] the row remains status=pending until the next 60-second cron tick picks it up
    And [UI] no error appears to the calling user; latency degrades gracefully',
'implemented','none')
ON CONFLICT (scenario_id) DO UPDATE
  SET gherkin = EXCLUDED.gherkin, title = EXCLUDED.title, status = EXCLUDED.status, updated_at = now();