-- Audit H9 — PII retention & GDPR erasure propagation for the email + Gumroad
-- sinks. Two long-lived stores held personal data that survived account
-- deletion:
--   1. email_send_log — rendered email + templateData PII in metadata (now
--      stripped at the write site in transactional-email.ts) AND recipient_email;
--      handle_user_deletion never touched this table.
--   2. gumroad_sales.raw_payload — the full raw webhook body (buyer email, name,
--      purchase details) with NO retention and NO erasure propagation.
-- This migration (a) propagates erasure to both on user delete, (b) back-fills
-- the historical rendered-content PII out of email_send_log.metadata, and (c)
-- adds a retention job that redacts aged raw Gumroad payloads.

-- ── (a) Erasure propagation ──────────────────────────────────────────────────
-- CREATE OR REPLACE handle_user_deletion, keeping every existing cleanup and
-- ADDING the two PII sinks. Runs BEFORE DELETE ON auth.users, so OLD.id / OLD.email
-- identify the departing user. email_send_log has no user_id column — it is keyed
-- by recipient_email. gumroad_sales is ANONYMIZED (not deleted) so the
-- event-sourced membership ledger / financial history stays intact; the projection
-- trigger it fires reads the ledger (never raw_payload) and no-ops here.
CREATE OR REPLACE FUNCTION public.handle_user_deletion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  -- H9 (erasure correctness): mark that this auth.users row is already being
  -- deleted, so the AFTER-DELETE cascade on public.profiles below does NOT try
  -- to re-delete the SAME auth.users tuple (self-referential delete → Postgres
  -- "tuple already modified" error that rolled back the ENTIRE deletion, i.e.
  -- GDPR erasure silently failed). Transaction-local; see the cascade guard.
  PERFORM set_config('app.erasing_auth_user', OLD.id::text, true);

  DELETE FROM public.user_quest_selections WHERE user_id = OLD.id;
  DELETE FROM public.push_subscriptions WHERE user_id = OLD.id;
  DELETE FROM public.chat_messages WHERE conversation_id IN (
    SELECT id FROM public.chat_conversations WHERE user_id = OLD.id
  );
  DELETE FROM public.chat_conversations WHERE user_id = OLD.id;
  DELETE FROM public.journey_progress WHERE user_id = OLD.id;
  DELETE FROM public.announcement_reads WHERE user_id = OLD.id;
  DELETE FROM public.dashboard_preferences WHERE user_id = OLD.id;
  DELETE FROM public.grid_view_states WHERE user_id = OLD.id;
  DELETE FROM public.project_applications WHERE user_id = OLD.id;
  DELETE FROM public.general_applications WHERE user_id = OLD.id;
  DELETE FROM public.admin_promotions WHERE user_id = OLD.id;
  DELETE FROM public.user_roles WHERE user_id = OLD.id;
  DELETE FROM public.notifications WHERE user_id = OLD.id;
  DELETE FROM public.feedback WHERE user_id = OLD.id;

  -- H9: email delivery logs (rendered content already stripped at write time;
  -- recipient_email + any residual metadata scrubbed here) are keyed by email.
  IF OLD.email IS NOT NULL THEN
    DELETE FROM public.email_send_log WHERE lower(recipient_email) = lower(OLD.email);
  END IF;

  -- H9: anonymize Gumroad sales — drop the raw webhook payload and redact the
  -- buyer email while preserving the structured/financial row + ledger linkage.
  UPDATE public.gumroad_sales
     SET email = 'erased@gdpr.invalid',
         raw_payload = '{}'::jsonb
   WHERE resolved_user_id = OLD.id
      OR (OLD.email IS NOT NULL AND lower(email) = lower(OLD.email));

  -- audit_log intentionally retained for SOC 2 hash-chain (append-only).
  DELETE FROM public.profiles WHERE user_id = OLD.id;
  RETURN OLD;
END;
$function$;

-- Guard the profile→auth cascade against the self-referential re-delete. When
-- deletion originates at auth.users, handle_user_deletion set the txn-local flag
-- above; the cascade then skips (the auth row is already being removed). When a
-- profile is deleted directly (flag unset), the cascade still removes the auth
-- row as before — preserving "no ghost accounts".
CREATE OR REPLACE FUNCTION public.cascade_delete_auth_user_on_profile_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF OLD.user_id IS NOT NULL
     AND current_setting('app.erasing_auth_user', true) IS DISTINCT FROM OLD.user_id::text THEN
    DELETE FROM auth.users WHERE id = OLD.user_id;
  END IF;
  RETURN OLD;
EXCEPTION WHEN OTHERS THEN
  -- Never block the profile delete on auth cleanup; surface via audit instead.
  INSERT INTO public.audit_log (event_type, table_name, record_id, error_message)
  VALUES ('cascade_auth_delete_failed', 'profiles', OLD.user_id, SQLERRM);
  RETURN OLD;
END;
$$;

-- ── (b) One-time backfill: strip historical rendered-content PII ──────────────
-- Remove the two PII-bearing metadata keys from existing rows. Structured
-- observability keys (idempotency_key, queue_name, queued_at, ...) are retained.
UPDATE public.email_send_log
   SET metadata = (metadata - 'queue_payload' - 'templateData')
 WHERE metadata IS NOT NULL
   AND (metadata ? 'queue_payload' OR metadata ? 'templateData');

-- ── (c) Retention for raw Gumroad payloads ───────────────────────────────────
-- raw_payload is only needed for short-window reconciliation/debugging. Redact
-- it after 180 days; the structured columns (tier, status, user, amount) and the
-- membership ledger remain the durable record.
CREATE OR REPLACE FUNCTION public.prune_gumroad_raw_payloads()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer;
BEGIN
  WITH redacted AS (
    UPDATE public.gumroad_sales
       SET raw_payload = '{}'::jsonb
     WHERE received_at < now() - interval '180 days'
       AND raw_payload <> '{}'::jsonb
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM redacted;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.prune_gumroad_raw_payloads() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_gumroad_raw_payloads() TO service_role;

-- Schedule daily at 03:20 (offset from prune-email-send-log at 03:10). Guarded so
-- a fresh replay / CI env without pg_cron skips rather than fails.
DO $$
DECLARE v_jobid BIGINT;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'prune-gumroad-raw-payloads';
    IF v_jobid IS NOT NULL THEN PERFORM cron.unschedule(v_jobid); END IF;
    PERFORM cron.schedule(
      'prune-gumroad-raw-payloads',
      '20 3 * * *',
      $cron$ SELECT public.prune_gumroad_raw_payloads(); $cron$
    );
  END IF;
END;
$$;
