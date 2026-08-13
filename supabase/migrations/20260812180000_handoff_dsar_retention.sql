-- Wave 4 (compliance lifecycle): DSAR erasure + retention reach the hand-off stores.
--
-- The DPIA flagged this as a tracked gap: account deletion (the single erasure entrypoint,
-- BEFORE DELETE ON auth.users -> handle_user_deletion) scrubbed email/gumroad/etc. but left the
-- departing user's uploaded hand-off deliverables — their reflections, files, and links, which are
-- Restricted personal data. This closes it and adds a retention prune so old hand-off versions
-- don't accumulate Restricted data forever.
--
-- Scope decision (recorded): a user's OWN submissions are their personal data and are erased. The
-- GENERATED hand-offs are shared project work product containing many people's data (like a commit)
-- and are NOT deleted on one contributor's DSAR; that user's identity in them
-- (handoff_productions.triggered_by) becomes a dangling UUID once auth.users + profiles are gone
-- (de facto pseudonymized), and their project_applications membership is already deleted below.

-- ── (a) Extend erasure propagation ───────────────────────────────────────────
-- CREATE OR REPLACE the whole function: every existing cleanup is preserved verbatim; the hand-off
-- block is added just before the profiles delete.
CREATE OR REPLACE FUNCTION public.handle_user_deletion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
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

  IF OLD.email IS NOT NULL THEN
    DELETE FROM public.email_send_log WHERE lower(recipient_email) = lower(OLD.email);
  END IF;

  UPDATE public.gumroad_sales
     SET email = 'erased@gdpr.invalid',
         raw_payload = '{}'::jsonb
   WHERE resolved_user_id = OLD.id
      OR (OLD.email IS NOT NULL AND lower(email) = lower(OLD.email));

  -- Wave 4: hand-off deliverable submissions are the departing user's uploaded personal-data
  -- content. Best-effort remove the backing blobs first (a storage hiccup must NOT roll back the
  -- whole erasure — surface it via audit_log instead), then delete the rows.
  BEGIN
    DELETE FROM storage.objects
     WHERE bucket_id = 'handoff-deliverables'
       AND name IN (
         SELECT file_path FROM public.handoff_deliverable_submissions
         WHERE created_by = OLD.id AND file_path IS NOT NULL
       );
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.audit_log (event_type, table_name, record_id, error_message)
    VALUES ('handoff_blob_erase_failed', 'handoff_deliverable_submissions', OLD.id, SQLERRM);
  END;
  DELETE FROM public.handoff_deliverable_submissions WHERE created_by = OLD.id;

  -- audit_log intentionally retained for SOC 2 hash-chain (append-only).
  DELETE FROM public.profiles WHERE user_id = OLD.id;
  RETURN OLD;
END;
$function$;

-- ── (b) Retention: prune superseded hand-off versions ────────────────────────
-- Keeps the LATEST hand-off per project+phase indefinitely; removes older, terminal versions past
-- the retention window (and their output blobs + file rows via FK cascade). Caps unbounded growth
-- of Restricted generated documents. Idempotent; returns how many runs it pruned.
CREATE OR REPLACE FUNCTION public.prune_handoff_productions(p_retention_days integer DEFAULT 365)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_count integer;
BEGIN
  -- Best-effort blob cleanup for the runs about to be pruned (never block the prune on storage).
  BEGIN
    DELETE FROM storage.objects
     WHERE bucket_id = 'handoff-outputs'
       AND name IN (
         SELECT f.storage_path
         FROM public.handoff_output_files f
         JOIN public.handoff_productions p ON p.id = f.production_id
         WHERE p.is_latest = false
           AND p.status IN ('complete','failed','canceled')
           AND p.created_at < now() - make_interval(days => p_retention_days)
       );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  WITH pruned AS (
    DELETE FROM public.handoff_productions
     WHERE is_latest = false
       AND status IN ('complete','failed','canceled')
       AND created_at < now() - make_interval(days => p_retention_days)
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM pruned;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.prune_handoff_productions(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_handoff_productions(integer) TO service_role;

-- Schedule weekly (Sun 03:40, offset from the other prune jobs). Guarded so a fresh replay / CI env
-- without pg_cron skips rather than fails.
DO $$
DECLARE v_jobid BIGINT;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'prune-handoff-productions';
    IF v_jobid IS NOT NULL THEN PERFORM cron.unschedule(v_jobid); END IF;
    PERFORM cron.schedule(
      'prune-handoff-productions',
      '40 3 * * 0',
      $cron$ SELECT public.prune_handoff_productions(); $cron$
    );
  END IF;
END;
$$;
