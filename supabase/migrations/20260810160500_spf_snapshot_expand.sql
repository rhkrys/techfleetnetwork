-- SPF data layer — EXPAND step (ADR-0001/0002/0003).
-- Purpose: stand up the SPF snapshot + the source-toggle + crosswalks ALONGSIDE the existing
-- reference_* / framework_edges graph. This migration is strictly ADDITIVE: it creates new
-- objects only, changes nothing existing, and no consumer reads these tables yet (the facade
-- flip happens in Phase A2/A3). Rollback of this step = drop the new objects; the live graph is
-- untouched. Idempotent / re-runnable.
--
-- Follows repo conventions: singleton *_config table (email_policy_config precedent), the
-- reference_data_sources RLS template (admin-read / service-write; anon SELECT where the view
-- contract needs it), plain SQL, IF NOT EXISTS.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Raw provenance store — one row per (dataset, synced version). Rollback source of truth.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.spf_datasets_raw (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity        text        NOT NULL,               -- SPF dataset key, e.g. 'handoff-deliverables-map'
  spf_version   text        NOT NULL,               -- pinned API version, e.g. 'v1'
  checksum      text        NOT NULL,               -- SHA-256 of the fetched payload
  record_count  integer     NOT NULL DEFAULT 0,
  raw           jsonb       NOT NULL,               -- verbatim fetched array (provenance)
  fetched_at    timestamptz NOT NULL DEFAULT now(),
  fetched_by    uuid,                               -- null when run by the scheduled service job
  is_active     boolean     NOT NULL DEFAULT false, -- true = the snapshot currently promoted
  CONSTRAINT spf_datasets_raw_entity_version_checksum_key UNIQUE (entity, spf_version, checksum)
);
-- Only one active raw row per (entity, version) — enforces the atomic-swap invariant.
CREATE UNIQUE INDEX IF NOT EXISTS spf_datasets_raw_one_active_per_entity
  ON public.spf_datasets_raw (entity, spf_version) WHERE is_active;
CREATE INDEX IF NOT EXISTS spf_datasets_raw_entity_idx ON public.spf_datasets_raw (entity);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Normalized snapshot — mirrors the framework_entity_v 9-column contract so the Phase-A2
--    facade view can UNION from here with zero shape change. `data` keeps the full SPF record.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.spf_entity (
  entity_type text        NOT NULL,                 -- singular, matches framework_entity_type enum labels
  id          uuid        NOT NULL DEFAULT gen_random_uuid(),
  slug        text        NOT NULL,
  name        text        NOT NULL,
  description text,
  category    text,
  data        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  is_active   boolean     NOT NULL DEFAULT true,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  spf_version text        NOT NULL,
  PRIMARY KEY (entity_type, slug)
);
CREATE INDEX IF NOT EXISTS spf_entity_data_gin ON public.spf_entity USING gin (data jsonb_path_ops);
CREATE INDEX IF NOT EXISTS spf_entity_type_active_idx ON public.spf_entity (entity_type) WHERE is_active;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Source toggle — singleton config the Phase-A2 facade + read RPCs consult. Default keeps
--    the OLD reference_* source live (fail-safe). Mirrors email_policy_config (id=1 CHECK).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.framework_source_config (
  id                 integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  active_source      text        NOT NULL DEFAULT 'reference' CHECK (active_source IN ('reference', 'spf')),
  spf_active_version text,                           -- pinned version when active_source='spf'
  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         uuid
);
INSERT INTO public.framework_source_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Crosswalks for CSV row 19 "varies by project type" — local enums ↔ SPF slugs (clean 5↔5).
-- ─────────────────────────────────────────────────────────────────────────────
-- NOTE: this is NOT a clean 5↔5 bijection. Local `strategy` has no SPF counterpart, and SPF
-- `mobile-app-project` has no local counterpart; `application_design` plausibly maps to EITHER
-- web-application-project or mobile-app-project. Only the 4 confident mappings are asserted;
-- `strategy` is left unmapped (spf_slug NULL) pending owner confirmation. Unmapped types get NO
-- project-type-specific SPF enrichment (safe default), rather than a fabricated mapping.
CREATE TABLE IF NOT EXISTS public.spf_project_type_map (
  local_project_type text PRIMARY KEY,              -- project_type enum value
  spf_slug           text,                          -- nullable: NULL = unmapped, needs owner decision
  note               text
);
INSERT INTO public.spf_project_type_map (local_project_type, spf_slug, note) VALUES
  ('website_design',     'website-project',         NULL),
  ('application_design', 'web-application-project',  'ambiguous: SPF also has mobile-app-project; confirm'),
  ('service_design',     'service-design-project',  NULL),
  ('discovery',          'discovery-project',        NULL),
  ('strategy',           NULL,                       'no SPF project-type counterpart; owner to confirm')
ON CONFLICT (local_project_type) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.spf_project_phase_map (
  local_project_phase text PRIMARY KEY,             -- project_phase enum value
  spf_slug            text NOT NULL
);
INSERT INTO public.spf_project_phase_map (local_project_phase, spf_slug) VALUES
  ('phase_1', 'phase-1'),
  ('phase_2', 'phase-2'),
  ('phase_3', 'phase-3'),
  ('phase_4', 'phase-n-1')
ON CONFLICT (local_project_phase) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. RLS — admin/authenticated read; service_role writes; anon SELECT on the snapshot + config
--    reads mirror the framework_entity_v anon grant the facade will preserve. (reference_data_sources template.)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.spf_datasets_raw        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spf_entity              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.framework_source_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spf_project_type_map    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spf_project_phase_map   ENABLE ROW LEVEL SECURITY;

-- spf_entity + crosswalks: public framework data → readable like framework_entity_v (anon+authenticated).
GRANT SELECT ON public.spf_entity            TO authenticated, anon;
GRANT SELECT ON public.spf_project_type_map  TO authenticated, anon;
GRANT SELECT ON public.spf_project_phase_map TO authenticated, anon;
GRANT ALL    ON public.spf_entity            TO service_role;
GRANT ALL    ON public.spf_datasets_raw      TO service_role;
GRANT ALL    ON public.framework_source_config TO service_role;
GRANT ALL    ON public.spf_project_type_map  TO service_role;
GRANT ALL    ON public.spf_project_phase_map TO service_role;
GRANT SELECT ON public.spf_datasets_raw      TO authenticated;
GRANT SELECT ON public.framework_source_config TO authenticated;

DO $$
BEGIN
  -- spf_entity: public read (framework data is public), service writes.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='spf_entity' AND policyname='spf_entity public read') THEN
    CREATE POLICY "spf_entity public read" ON public.spf_entity FOR SELECT TO authenticated, anon USING (is_active);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='spf_entity' AND policyname='spf_entity service writes') THEN
    CREATE POLICY "spf_entity service writes" ON public.spf_entity FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;

  -- spf_datasets_raw: admin read (provenance), service writes.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='spf_datasets_raw' AND policyname='spf_datasets_raw admin read') THEN
    CREATE POLICY "spf_datasets_raw admin read" ON public.spf_datasets_raw FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='spf_datasets_raw' AND policyname='spf_datasets_raw service writes') THEN
    CREATE POLICY "spf_datasets_raw service writes" ON public.spf_datasets_raw FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;

  -- framework_source_config: admin read, service writes.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='framework_source_config' AND policyname='framework_source_config admin read') THEN
    CREATE POLICY "framework_source_config admin read" ON public.framework_source_config FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='framework_source_config' AND policyname='framework_source_config service writes') THEN
    CREATE POLICY "framework_source_config service writes" ON public.framework_source_config FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;

  -- crosswalks: public read, service writes.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='spf_project_type_map' AND policyname='spf_project_type_map public read') THEN
    CREATE POLICY "spf_project_type_map public read" ON public.spf_project_type_map FOR SELECT TO authenticated, anon USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='spf_project_type_map' AND policyname='spf_project_type_map service writes') THEN
    CREATE POLICY "spf_project_type_map service writes" ON public.spf_project_type_map FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='spf_project_phase_map' AND policyname='spf_project_phase_map public read') THEN
    CREATE POLICY "spf_project_phase_map public read" ON public.spf_project_phase_map FOR SELECT TO authenticated, anon USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='spf_project_phase_map' AND policyname='spf_project_phase_map service writes') THEN
    CREATE POLICY "spf_project_phase_map service writes" ON public.spf_project_phase_map FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

COMMENT ON TABLE public.spf_entity IS 'SPF snapshot (derived index of the public v1 API; ADR-0001). Mirrors the framework_entity_v 9-col contract for the Phase-A2 facade. Not yet read by any consumer.';
COMMENT ON TABLE public.framework_source_config IS 'Singleton source toggle for the reference_*→SPF strangler-fig cutover (ADR-0003). Default reference (fail-safe).';
