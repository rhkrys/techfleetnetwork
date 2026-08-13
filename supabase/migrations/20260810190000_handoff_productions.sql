-- Hand-Off Production System: RUN + OUTPUT model (Phase B2).
-- A "production" is one async generation run for a project+phase; it moves through a state
-- machine and yields output files (4 audiences x {md,pdf}) in the private handoff-outputs bucket.
-- Enforces the one-run-per-project invariant at the DB level (partial unique index). No LLM here;
-- the orchestrator (handoff-produce edge fn) drives the states + writes rows via service_role.

CREATE TABLE IF NOT EXISTS public.handoff_productions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  phase        public.project_phase NOT NULL,
  status       text NOT NULL DEFAULT 'queued'
               CHECK (status IN ('queued','parsing','extracting','writing','rendering','complete','failed','canceled')),
  triggered_by uuid NOT NULL,
  is_latest    boolean NOT NULL DEFAULT true,
  spf_version  text,                              -- SPF snapshot version pinned for this run (reproducibility)
  model        text,                              -- LLM model id used (capability port; ADR-0005)
  idempotency_key text,                           -- de-dupes double "Produce" clicks
  error        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
-- One-run-per-(project,phase) invariant: only one non-terminal run may exist at a time.
CREATE UNIQUE INDEX IF NOT EXISTS handoff_productions_one_active
  ON public.handoff_productions (project_id, phase)
  WHERE status IN ('queued','parsing','extracting','writing','rendering');
-- Fast "latest per project+phase" lookup.
CREATE INDEX IF NOT EXISTS handoff_productions_latest_idx
  ON public.handoff_productions (project_id, phase, is_latest);
CREATE UNIQUE INDEX IF NOT EXISTS handoff_productions_idem
  ON public.handoff_productions (idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.handoff_output_files (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  production_id uuid NOT NULL REFERENCES public.handoff_productions(id) ON DELETE CASCADE,
  audience      text NOT NULL CHECK (audience IN ('client','teammate','teammate_case_study','org_case_study')),
  format        text NOT NULL CHECK (format IN ('md','pdf')),
  storage_path  text NOT NULL,                    -- path in handoff-outputs bucket
  checksum      text,
  bytes         integer,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (production_id, audience, format)
);

ALTER TABLE public.handoff_productions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.handoff_output_files ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.handoff_productions  TO authenticated;
GRANT SELECT ON public.handoff_output_files TO authenticated;
GRANT ALL ON public.handoff_productions  TO service_role;
GRANT ALL ON public.handoff_output_files TO service_role;

DO $$
BEGIN
  -- Active members of the project may READ its runs + outputs (retrievable via My Projects).
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='handoff_productions' AND policyname='handoff_prod member read') THEN
    CREATE POLICY "handoff_prod member read" ON public.handoff_productions
      FOR SELECT TO authenticated USING (public.handoff_is_active_member(project_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='handoff_productions' AND policyname='handoff_prod admin read') THEN
    CREATE POLICY "handoff_prod admin read" ON public.handoff_productions
      FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
  END IF;
  -- Output files: readable if you can read the parent run.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='handoff_output_files' AND policyname='handoff_out member read') THEN
    CREATE POLICY "handoff_out member read" ON public.handoff_output_files
      FOR SELECT TO authenticated USING (EXISTS (
        SELECT 1 FROM public.handoff_productions p
        WHERE p.id = production_id AND public.handoff_is_active_member(p.project_id)
      ));
  END IF;
END $$;

-- Private bucket for produced documents. Signed-URL access is issued server-side (Phase B3),
-- scoped + ownership-re-checked; no blanket object policy for downloads.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('handoff-outputs', 'handoff-outputs', false, 26214400,
        ARRAY['text/markdown','text/plain','application/pdf'])
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE public.handoff_productions IS
  'One async hand-off generation run per project+phase (Phase B2). Partial unique index enforces one active run at a time (no double-produce). spf_version pins the snapshot for reproducibility.';
