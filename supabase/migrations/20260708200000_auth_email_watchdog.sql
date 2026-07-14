-- Auth-email watchdog: make "auth emails silently stopped" impossible to miss.
--
-- Context: at cutover the Supabase Send Email Hook was lost, so signup/reset
-- emails silently fell back to the rate-limited built-in service and mostly
-- never delivered — for ~2.5 weeks, with ZERO alarms. The synthetic auth-prober
-- was dark (0 rows ever; AUTH_PROBER_* unset) and the web-push alert path had
-- not fired since cutover. This watchdog is a pure-DB backstop that depends on
-- NONE of email / web-push / edge-function deploys, so it keeps working even
-- when those break.
--
-- Signal: real email/password signups are happening but GoTrue is recording no
-- confirmation-email sends (confirmation_sent_at). That is the exact, provider-
-- independent signature of "auth email is broken". Also surfaces reset activity
-- and whether the active canary (auth_prober_results) is fresh.

-- ── 1. Health verdict (aggregate-only, no PII) ───────────────────────────────
CREATE OR REPLACE FUNCTION public.auth_email_health()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sign6 int; v_conf6 int; v_sign24 int; v_conf24 int;
  v_recov24 int; v_last_recov timestamptz; v_last_conf timestamptz;
  v_prober_last timestamptz;
  v_healthy boolean := true; v_reason text := 'ok';
BEGIN
  -- Count only email/password signups (OAuth signups are auto-confirmed and
  -- never trigger a confirmation email, so they must not skew the signal).
  SELECT
    count(*) FILTER (WHERE created_at > now()-interval '6 hours'
                     AND raw_app_meta_data->>'provider' = 'email'),
    count(*) FILTER (WHERE created_at > now()-interval '6 hours'
                     AND raw_app_meta_data->>'provider' = 'email'
                     AND confirmation_sent_at IS NOT NULL),
    count(*) FILTER (WHERE created_at > now()-interval '24 hours'
                     AND raw_app_meta_data->>'provider' = 'email'),
    count(*) FILTER (WHERE created_at > now()-interval '24 hours'
                     AND raw_app_meta_data->>'provider' = 'email'
                     AND confirmation_sent_at IS NOT NULL),
    count(*) FILTER (WHERE recovery_sent_at > now()-interval '24 hours'),
    max(recovery_sent_at), max(confirmation_sent_at)
  INTO v_sign6, v_conf6, v_sign24, v_conf24, v_recov24, v_last_recov, v_last_conf
  FROM auth.users;

  SELECT max(created_at) INTO v_prober_last FROM public.auth_prober_results;

  -- Alarm conditions (conservative → low false-positive):
  --  fast: >=3 email signups in 6h and NONE got a confirmation send
  --  slow: >=5 email signups in 24h and NONE got a confirmation send
  IF (v_sign6 >= 3 AND v_conf6 = 0) THEN
    v_healthy := false;
    v_reason := format('%s email signups in 6h but 0 confirmation emails sent', v_sign6);
  ELSIF (v_sign24 >= 5 AND v_conf24 = 0) THEN
    v_healthy := false;
    v_reason := format('%s email signups in 24h but 0 confirmation emails sent', v_sign24);
  END IF;

  RETURN jsonb_build_object(
    'healthy', v_healthy,
    'reason', v_reason,
    'email_signups_6h', v_sign6,
    'confirmations_6h', v_conf6,
    'email_signups_24h', v_sign24,
    'confirmations_24h', v_conf24,
    'recovery_sent_24h', v_recov24,
    'last_recovery_sent', v_last_recov,
    'last_confirmation_sent', v_last_conf,
    'prober_last_result_at', v_prober_last,
    'prober_fresh', (v_prober_last IS NOT NULL AND v_prober_last > now()-interval '30 minutes'),
    'checked_at', now()
  );
END $$;

REVOKE ALL ON FUNCTION public.auth_email_health() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auth_email_health() TO service_role;

-- ── 2. Watchdog state (dedup alerts) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.auth_watchdog_state (
  id            int PRIMARY KEY DEFAULT 1,
  last_status   text,
  last_alert_at timestamptz,
  updated_at    timestamptz DEFAULT now(),
  CONSTRAINT auth_watchdog_singleton CHECK (id = 1)
);
INSERT INTO public.auth_watchdog_state (id) VALUES (1) ON CONFLICT DO NOTHING;
ALTER TABLE public.auth_watchdog_state ENABLE ROW LEVEL SECURITY;

-- ── 3. The watchdog: check health, record, and alert loudly on breakage ──────
CREATE OR REPLACE FUNCTION public.run_auth_email_watchdog()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_health jsonb;
  v_healthy boolean;
  v_reason text;
  v_last_alert timestamptz;
  v_webhook text;
  v_alerted boolean := false;
BEGIN
  v_health := public.auth_email_health();
  v_healthy := (v_health->>'healthy')::boolean;
  v_reason := v_health->>'reason';

  UPDATE public.auth_watchdog_state
     SET last_status = CASE WHEN v_healthy THEN 'healthy' ELSE 'broken' END,
         updated_at = now()
   WHERE id = 1;

  IF NOT v_healthy THEN
    -- Always record to ops_events so it is visible in System Health/Triage even
    -- if no Discord webhook is configured.
    PERFORM public.record_event(
      'ops_events', 'auth.email.watchdog_alarm', NULL, v_health, 'error', 'auth-email-watchdog'
    );

    -- Loud alert to Discord (independent of the email + web-push paths), at most
    -- once every 2 hours. Webhook URL lives in Vault as 'discord_alert_webhook'.
    SELECT last_alert_at INTO v_last_alert FROM public.auth_watchdog_state WHERE id = 1;
    IF v_last_alert IS NULL OR v_last_alert < now() - interval '2 hours' THEN
      BEGIN
        SELECT decrypted_secret INTO v_webhook
        FROM vault.decrypted_secrets WHERE name = 'discord_alert_webhook' LIMIT 1;
      EXCEPTION WHEN OTHERS THEN v_webhook := NULL;
      END;

      IF v_webhook IS NOT NULL THEN
        PERFORM net.http_post(
          url := v_webhook,
          headers := jsonb_build_object('Content-Type', 'application/json'),
          body := jsonb_build_object(
            'content',
            '🚨 **AUTH EMAIL WATCHDOG** — ' || v_reason ||
            '. Password-reset/signup emails may be failing. Check Supabase Auth → SMTP + Resend NOW. ' ||
            'Details: ' || v_health::text
          )
        );
        v_alerted := true;
      END IF;

      UPDATE public.auth_watchdog_state SET last_alert_at = now() WHERE id = 1;
    END IF;
  END IF;

  RETURN jsonb_build_object('healthy', v_healthy, 'reason', v_reason, 'alerted', v_alerted, 'health', v_health);
END $$;

REVOKE ALL ON FUNCTION public.run_auth_email_watchdog() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_auth_email_watchdog() TO service_role;

-- ── 4. Schedule it every 15 minutes (pure DB; no edge fn, no push) ───────────
DO $$
BEGIN
  PERFORM cron.unschedule(jobname) FROM cron.job WHERE jobname = 'auth_email_watchdog_15m';
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
SELECT cron.schedule(
  'auth_email_watchdog_15m', '*/15 * * * *',
  $cmd$ SELECT public.run_auth_email_watchdog(); $cmd$
);
