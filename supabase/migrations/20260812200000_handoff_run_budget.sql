-- Hand-Off re-create budget + writer-only retry (Phase B2/B3, cost control).
--
-- Owner rule: per project+phase, TEAM-WIDE, exactly 1 production + 1 self-service retry. The retry
-- is WRITER-ONLY — it reuses the stored fact base and re-runs only the selected audiences' writer,
-- skipping the expensive extraction. This caps LLM spend hard while letting a team fix a version.
--
--  - handoff_run_budget: a persistent per-(project,phase) counter. Persistent (not derived from
--    counting handoff_productions rows) so the retention prune of archived runs can NEVER silently
--    reset the budget. Claimed atomically so two simultaneous "Produce" clicks can't both pass.
--  - handoff_fact_base: the extracted fact base kept per (project,phase) so a writer-only retry
--    reuses it instead of re-extracting. Restricted (derived from personal-data uploads) — retained
--    for the window like the generated outputs, pruned by retention.
--  - handoff_productions.audiences / writer_only: scope a run to a subset of the four versions and
--    tell the worker to skip extraction and load the stored fact base.

-- ── Budget counter ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.handoff_run_budget (
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  phase      public.project_phase NOT NULL,
  runs_used  integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, phase)
);
ALTER TABLE public.handoff_run_budget ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.handoff_run_budget TO authenticated;
GRANT ALL ON public.handoff_run_budget TO service_role;

-- Active members may READ their project's budget (the UI shows "retry remaining"); only the
-- service-role produce path writes it, via the atomic claim RPC below.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='handoff_run_budget' AND policyname='handoff_budget member read') THEN
    CREATE POLICY "handoff_budget member read" ON public.handoff_run_budget
      FOR SELECT TO authenticated USING (public.handoff_is_active_member(project_id));
  END IF;
END $$;

-- Atomic enqueue: check the budget, create the run, and bump the counter in ONE transaction so a
-- double-click can never burn the team's single retry (a failed insert rolls the whole thing back,
-- counter untouched). Decides full-vs-writer-only INSIDE the lock: the 2nd+ run is writer-only IFF a
-- fact base already exists (a failed first production that never extracted falls back to a full run).
-- Returns a status object the edge function maps to a response.
CREATE OR REPLACE FUNCTION public.handoff_enqueue_production(
  p_project_id uuid, p_phase public.project_phase, p_triggered_by uuid,
  p_spf_version text, p_model text, p_idempotency_key text,
  p_audiences text[] DEFAULT NULL, p_cap integer DEFAULT 2
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_used integer;
  v_run uuid;
  v_writer_only boolean;
  v_audiences text[];
BEGIN
  SELECT runs_used INTO v_used FROM public.handoff_run_budget
    WHERE project_id = p_project_id AND phase = p_phase FOR UPDATE;
  v_used := COALESCE(v_used, 0);
  IF v_used >= p_cap THEN
    RETURN jsonb_build_object('status', 'budget_exceeded');
  END IF;

  v_writer_only := (v_used >= 1)
    AND EXISTS (SELECT 1 FROM public.handoff_fact_base WHERE project_id = p_project_id AND phase = p_phase);
  v_audiences := CASE WHEN v_writer_only
                      THEN COALESCE(p_audiences, ARRAY['client','teammate','teammate_case_study','org_case_study'])
                      ELSE NULL END;

  BEGIN
    INSERT INTO public.handoff_productions
      (project_id, phase, status, triggered_by, spf_version, model, idempotency_key, audiences, writer_only)
    VALUES
      (p_project_id, p_phase, 'queued', p_triggered_by, p_spf_version, p_model, p_idempotency_key, v_audiences, v_writer_only)
    RETURNING id INTO v_run;
  EXCEPTION WHEN unique_violation THEN
    IF p_idempotency_key IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.handoff_productions WHERE idempotency_key = p_idempotency_key) THEN
      RETURN jsonb_build_object('status', 'duplicate');
    END IF;
    RETURN jsonb_build_object('status', 'in_progress'); -- one-run-per-project partial unique index
  END;

  INSERT INTO public.handoff_run_budget (project_id, phase, runs_used)
  VALUES (p_project_id, p_phase, 1)
  ON CONFLICT (project_id, phase) DO UPDATE
    SET runs_used = public.handoff_run_budget.runs_used + 1, updated_at = now();

  RETURN jsonb_build_object('status', 'queued', 'run_id', v_run,
                            'ordinal', v_used + 1, 'writer_only', v_writer_only);
END $$;
REVOKE ALL ON FUNCTION public.handoff_enqueue_production(uuid, public.project_phase, uuid, text, text, text, text[], integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handoff_enqueue_production(uuid, public.project_phase, uuid, text, text, text, text[], integer) TO service_role;

-- ── Persisted fact base (writer-only retry reuse) ────────────────────────────
CREATE TABLE IF NOT EXISTS public.handoff_fact_base (
  project_id  uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  phase       public.project_phase NOT NULL,
  facts       jsonb NOT NULL,             -- ComponentFactBase[] from the extract stage
  spf_version text,
  built_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, phase)
);
-- Internal only: the pipeline (service role) reads/writes it; no client ever needs it. RLS on with
-- NO authenticated policy = deny-by-default for anon/authenticated; service_role bypasses.
ALTER TABLE public.handoff_fact_base ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.handoff_fact_base TO service_role;

-- ── Run scoping ──────────────────────────────────────────────────────────────
ALTER TABLE public.handoff_productions
  ADD COLUMN IF NOT EXISTS audiences   text[],                       -- NULL = all four; subset = targeted re-create
  ADD COLUMN IF NOT EXISTS writer_only boolean NOT NULL DEFAULT false; -- skip extraction, reuse handoff_fact_base

-- The worker claim RPC must surface the two new scoping columns so the worker can drive a
-- writer-only, audience-scoped run. Return-signature change => DROP + recreate (body unchanged
-- except for the two extra RETURNING columns). Kept in lockstep with the original definition.
DROP FUNCTION IF EXISTS public.handoff_claim_run(text, integer, integer);
CREATE OR REPLACE FUNCTION public.handoff_claim_run(
  p_worker_id text,
  p_lease_seconds integer DEFAULT 120,
  p_max_attempts integer DEFAULT 6
) RETURNS TABLE (
  id uuid, project_id uuid, phase public.project_phase,
  spf_version text, model text, pipeline_state jsonb, attempts integer,
  audiences text[], writer_only boolean
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
    RETURN;
  END IF;

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
    attempts         = hp.attempts + CASE WHEN v_prev_worker IS NOT NULL THEN 1 ELSE 0 END,
    updated_at       = now()
  WHERE hp.id = v_id
  RETURNING hp.id, hp.project_id, hp.phase, hp.spf_version, hp.model, hp.pipeline_state, hp.attempts,
            hp.audiences, hp.writer_only;
END $$;
REVOKE ALL ON FUNCTION public.handoff_claim_run(text, integer, integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handoff_claim_run(text, integer, integer) TO service_role;

COMMENT ON COLUMN public.handoff_productions.audiences IS
  'Which of the four versions this run (re)writes. NULL = full production of all four; a subset = a targeted, writer-only re-create.';
COMMENT ON COLUMN public.handoff_productions.writer_only IS
  'True for a re-create that reuses handoff_fact_base and re-runs only the writer for `audiences`, skipping extraction (cost control).';
COMMENT ON TABLE public.handoff_run_budget IS
  'Team-wide re-create budget per project+phase: 1 production + 1 self-service retry (cap enforced by handoff_claim_budget). Persistent so retention pruning of archived runs cannot reset it.';
