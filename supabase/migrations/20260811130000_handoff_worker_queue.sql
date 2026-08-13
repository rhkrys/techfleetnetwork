-- Hand-Off durable async worker queue (Phase B2).
--
-- A full hand-off run (extract per component + write per audience-arc + render/store per audience)
-- is far more work than one edge invocation can safely hold. Previously the front door ran it inline
-- via EdgeRuntime.waitUntil, so a recycled invocation left a run stuck 'writing' forever, with no
-- retry and no resume. This turns handoff_productions into a DURABLE, LEASED work queue drained by a
-- pg_cron-driven worker (the same cron -> net.http_post -> edge-function idiom as the email crons),
-- with checkpointed resumable state so a killed worker continues where it left off.
--
--  - lease: worker_id + lease_expires_at + heartbeat_at. A claim leases a run; a clean mid-run
--    release makes it immediately re-claimable WITHOUT counting as a failure; only a DEATH (lease
--    expired while still owned) bumps `attempts` (the crash-recovery count).
--  - pipeline_state: the resumable cursor + accumulated fact base + written prose (cleared on done).
-- RPCs are SECURITY DEFINER and service_role-only; the worker authenticates with the service key.

ALTER TABLE public.handoff_productions
  ADD COLUMN IF NOT EXISTS worker_id        text,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS heartbeat_at     timestamptz,
  ADD COLUMN IF NOT EXISTS attempts         integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pipeline_state   jsonb;

-- Claim ordering: oldest eligible (queued or lease-expired) run first.
CREATE INDEX IF NOT EXISTS handoff_productions_claim_idx
  ON public.handoff_productions (created_at)
  WHERE status IN ('queued','parsing','extracting','writing','rendering');

-- Atomically claim the oldest run that needs work (new, or whose lease expired because its worker
-- died). Returns nothing if none is due. Runs past the crash-recovery cap are marked failed.
CREATE OR REPLACE FUNCTION public.handoff_claim_run(
  p_worker_id text,
  p_lease_seconds integer DEFAULT 120,
  p_max_attempts integer DEFAULT 6
) RETURNS TABLE (
  id uuid, project_id uuid, phase public.project_phase,
  spf_version text, model text, pipeline_state jsonb, attempts integer
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE
  v_id uuid;
  v_attempts integer;
  v_prev_worker text;
BEGIN
  SELECT hp.id, hp.attempts, hp.worker_id
    INTO v_id, v_attempts, v_prev_worker
  FROM public.handoff_productions hp
  WHERE hp.status IN ('queued','parsing','extracting','writing','rendering')
    AND (hp.lease_expires_at IS NULL OR hp.lease_expires_at <= now())
  ORDER BY hp.created_at
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF v_id IS NULL THEN
    RETURN; -- nothing due
  END IF;

  -- Too many crash-recoveries already: give up rather than loop forever.
  IF v_attempts >= p_max_attempts THEN
    UPDATE public.handoff_productions
      SET status = 'failed', error = COALESCE(error, 'exceeded max recovery attempts'),
          worker_id = NULL, lease_expires_at = NULL, updated_at = now()
      WHERE public.handoff_productions.id = v_id;
    RETURN;
  END IF;

  RETURN QUERY
  UPDATE public.handoff_productions hp SET
    status           = CASE WHEN hp.status = 'queued' THEN 'extracting' ELSE hp.status END,
    worker_id        = p_worker_id,
    lease_expires_at = now() + make_interval(secs => p_lease_seconds),
    heartbeat_at     = now(),
    -- Only a death (a still-owned run whose lease lapsed) counts against the recovery budget;
    -- a clean release (worker_id cleared) or a fresh queue pickup does not.
    attempts         = hp.attempts + CASE WHEN v_prev_worker IS NOT NULL THEN 1 ELSE 0 END,
    updated_at       = now()
  WHERE hp.id = v_id
  RETURNING hp.id, hp.project_id, hp.phase, hp.spf_version, hp.model, hp.pipeline_state, hp.attempts;
END $$;

-- Persist progress + extend the lease. Returns false if this worker no longer owns the run
-- (its lease was reclaimed) so the caller stops immediately.
CREATE OR REPLACE FUNCTION public.handoff_checkpoint_run(
  p_run_id uuid, p_worker_id text, p_lease_seconds integer, p_state jsonb, p_status text DEFAULT NULL
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rows integer;
BEGIN
  UPDATE public.handoff_productions SET
    pipeline_state   = p_state,
    status           = COALESCE(p_status, status),
    heartbeat_at     = now(),
    lease_expires_at = now() + make_interval(secs => p_lease_seconds),
    updated_at       = now()
  WHERE id = p_run_id AND worker_id = p_worker_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END $$;

-- Clean mid-run handoff: save state, drop the lease so the NEXT tick resumes immediately without
-- a crash penalty. Keeps the run's status (still in progress).
CREATE OR REPLACE FUNCTION public.handoff_release_run(
  p_run_id uuid, p_worker_id text, p_state jsonb
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rows integer;
BEGIN
  UPDATE public.handoff_productions SET
    pipeline_state = p_state, worker_id = NULL, lease_expires_at = now(), heartbeat_at = now(), updated_at = now()
  WHERE id = p_run_id AND worker_id = p_worker_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END $$;

-- Mark a run complete: flip it to latest, demote prior runs for the same project+phase, drop the
-- now-unneeded pipeline_state (data minimization: it holds the fact base + prose).
CREATE OR REPLACE FUNCTION public.handoff_complete_run(
  p_run_id uuid, p_worker_id text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_pid uuid; v_phase public.project_phase; v_rows integer;
BEGIN
  UPDATE public.handoff_productions SET
    status = 'complete', worker_id = NULL, lease_expires_at = NULL, pipeline_state = NULL, updated_at = now()
  WHERE id = p_run_id AND worker_id = p_worker_id
  RETURNING project_id, phase INTO v_pid, v_phase;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN RETURN false; END IF;
  UPDATE public.handoff_productions SET is_latest = false, updated_at = now()
  WHERE project_id = v_pid AND phase = v_phase AND id <> p_run_id AND is_latest;
  RETURN true;
END $$;

-- Mark a run failed (an unrecoverable error inside a worker tick).
CREATE OR REPLACE FUNCTION public.handoff_fail_run(
  p_run_id uuid, p_worker_id text, p_error text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rows integer;
BEGIN
  UPDATE public.handoff_productions SET
    status = 'failed', error = left(p_error, 500), worker_id = NULL, lease_expires_at = NULL, updated_at = now()
  WHERE id = p_run_id AND worker_id = p_worker_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END $$;

-- Service-role only: the worker holds the service key; no client may drive the queue.
REVOKE ALL ON FUNCTION public.handoff_claim_run(text, integer, integer)      FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.handoff_checkpoint_run(uuid, text, integer, jsonb, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.handoff_release_run(uuid, text, jsonb)         FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.handoff_complete_run(uuid, text)               FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.handoff_fail_run(uuid, text, text)             FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handoff_claim_run(text, integer, integer)      TO service_role;
GRANT EXECUTE ON FUNCTION public.handoff_checkpoint_run(uuid, text, integer, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.handoff_release_run(uuid, text, jsonb)         TO service_role;
GRANT EXECUTE ON FUNCTION public.handoff_complete_run(uuid, text)               TO service_role;
GRANT EXECUTE ON FUNCTION public.handoff_fail_run(uuid, text, text)             TO service_role;

-- Drive the worker once a minute (same Vault-secret Bearer idiom as the email crons). The worker
-- itself is a no-op when nothing is due, so a per-minute tick is cheap.
DO $$
DECLARE
  v_url  text := 'https://pzvqxdgoztbfikfuifix.supabase.co';
  v_auth text := $auth$'Bearer ' || COALESCE(
        (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key' LIMIT 1),
        (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_service_role_key' LIMIT 1),
        (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1),
        (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SERVICE_ROLE_KEY' LIMIT 1)
      )$auth$;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not installed; skipping handoff-worker schedule';
    RETURN;
  END IF;

  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'handoff-worker-1m';

  PERFORM cron.schedule(
    'handoff-worker-1m',
    '* * * * *',
    format($cmd$
      SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', %s),
        body := jsonb_build_object('source', 'cron', 'scheduled_at', now())
      );
    $cmd$, v_url || '/functions/v1/handoff-worker', v_auth)
  );
END $$;

COMMENT ON COLUMN public.handoff_productions.pipeline_state IS
  'Resumable step-machine state (cursor + accumulated fact base + written prose). Set while running, cleared on complete. Never read by clients (service_role only).';
COMMENT ON COLUMN public.handoff_productions.attempts IS
  'Crash-recovery count: bumped only when a still-owned run is reclaimed after its lease lapsed (a worker death), not on normal multi-tick progress.';
