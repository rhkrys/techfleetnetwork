-- Wave 0 · P1-5 / P1-6 — Revive the retention engine that died at cutover, and
-- fix its silently-broken audit-evidence write.
--
-- (a) enforce_retention_policy() (latest def 20260528152354) purges expired
--     deleted_users_ledger rows and anonymizes aged web-vitals / network-activity
--     / email-unsubscribes. It does NOT touch audit_log, so rescheduling it does
--     not collide with the append-only trigger. It was scheduled only pre-cutover
--     (20260507035848), so on the owned project it never runs — aged PII is not
--     anonymized. Reschedule it, portable + guarded.
-- (b) Its own compliance-evidence write inserted into NON-EXISTENT audit_log
--     columns (event_type, actor_id, target_type, target_id, payload) wrapped in
--     `EXCEPTION WHEN OTHERS THEN NULL`, so the `retention_policy_run` audit event
--     raised undefined_column and vanished every run. Correct it to the real
--     schema (event_type, table_name, record_id, user_id, changed_fields text[],
--     error_message) and surface failures as WARNING instead of swallowing them.
-- (c) ops_events carries `expires_at DEFAULT now()+90 days` with a purge index but
--     no purge worker (storage-limitation control not operating). Add a daily
--     purge on expires_at (ops_events is an operational sink, not append-only).
--
-- NOT in scope (Wave 1): audit_log retention itself — purge_old_audit_logs is
-- blocked by the append-only trigger and requires a controlled, audited erasure
-- path plus the erasure-vs-tamper-evidence design decision. Tracked separately.

-- ---- (a)+(b) enforce_retention_policy with corrected audit write ------------
CREATE OR REPLACE FUNCTION public.enforce_retention_policy()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_purged_ledger int := 0;
  v_anon_vitals int := 0;
  v_anon_network int := 0;
  v_anon_unsub int := 0;
  v_summary jsonb;
BEGIN
  WITH purged AS (
    DELETE FROM public.deleted_users_ledger
    WHERE purge_after < now()
    RETURNING 1
  )
  SELECT count(*) INTO v_purged_ledger FROM purged;

  IF to_regclass('public.web_vital_samples') IS NOT NULL THEN
    EXECUTE $sql$
      WITH upd AS (
        UPDATE public.web_vital_samples
        SET user_id = NULL
        WHERE user_id IS NOT NULL AND created_at < now() - interval '25 months'
        RETURNING 1
      ) SELECT count(*) FROM upd
    $sql$ INTO v_anon_vitals;
  END IF;

  IF to_regclass('public.network_activity') IS NOT NULL THEN
    EXECUTE $sql$
      WITH upd AS (
        UPDATE public.network_activity
        SET actor_id = NULL
        WHERE actor_id IS NOT NULL AND created_at < now() - interval '25 months'
        RETURNING 1
      ) SELECT count(*) FROM upd
    $sql$ INTO v_anon_network;
  END IF;

  IF to_regclass('public.email_unsubscribes') IS NOT NULL THEN
    EXECUTE $sql$
      WITH upd AS (
        UPDATE public.email_unsubscribes
        SET email = 'redacted+' || encode(extensions.digest(email::bytea, 'sha256'::text), 'hex') || '@redacted.invalid'
        WHERE email NOT LIKE 'redacted+%' AND created_at < now() - interval '5 years'
        RETURNING 1
      ) SELECT count(*) FROM upd
    $sql$ INTO v_anon_unsub;
  END IF;

  v_summary := jsonb_build_object(
    'purged_ledger_rows', v_purged_ledger,
    'anonymized_web_vitals', v_anon_vitals,
    'anonymized_network_activity', v_anon_network,
    'anonymized_email_unsubscribes', v_anon_unsub,
    'ran_at', now()
  );

  -- Compliance evidence that this control ran. Real audit_log schema (the prior
  -- INSERT used columns that do not exist and was silently swallowed). Direct
  -- INSERT is permitted by the append-only trigger and hash-chained normally.
  BEGIN
    INSERT INTO public.audit_log(event_type, table_name, record_id, user_id, changed_fields, error_message)
    VALUES (
      'retention_policy_run',
      'system',
      NULL,
      NULL,
      ARRAY[
        'purged_ledger_rows:' || v_purged_ledger,
        'anonymized_web_vitals:' || v_anon_vitals,
        'anonymized_network_activity:' || v_anon_network,
        'anonymized_email_unsubscribes:' || v_anon_unsub
      ]::text[],
      'retention policy run — ' || v_summary::text
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'enforce_retention_policy audit write failed: %', SQLERRM;
  END;

  RETURN v_summary;
END;
$function$;

-- ---- (a) reschedule + (c) ops_events purge ---------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not installed; skipping retention cron (re)schedule';
    RETURN;
  END IF;

  -- enforce_retention_policy — daily, off-peak (03:40 UTC; operator-tunable)
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'enforce_retention_policy_daily';
  PERFORM cron.schedule(
    'enforce_retention_policy_daily',
    '40 3 * * *',
    $cron$ SELECT public.enforce_retention_policy(); $cron$
  );

  -- ops_events 90-day expiry purge — daily, staggered
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'purge-ops-events-expired';
  PERFORM cron.schedule(
    'purge-ops-events-expired',
    '50 3 * * *',
    $cron$ DELETE FROM public.ops_events WHERE expires_at < now(); $cron$
  );
END
$$;
