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

  BEGIN
    INSERT INTO public.audit_log(event_type, actor_id, target_type, target_id, payload)
    VALUES ('retention_policy_run', NULL, 'system', NULL, v_summary);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN v_summary;
END;
$function$;