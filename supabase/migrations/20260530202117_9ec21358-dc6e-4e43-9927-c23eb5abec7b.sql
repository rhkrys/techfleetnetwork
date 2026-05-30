-- DB-First Content Architecture: Phases 1 (policies), 2 (framework CSVs), 4 (rails)
-- Adds canonical content storage in policy_versions, ingest provenance in
-- reference_data_sources, and admin-only Storage buckets for source archives.

-- =========================================================================
-- PHASE 1: Policies become DB-driven
-- =========================================================================

-- Drop the old composite PK so we can re-key with language; backfill below.
ALTER TABLE public.policy_versions DROP CONSTRAINT IF EXISTS policy_versions_pkey;

ALTER TABLE public.policy_versions
  ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS title text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS summary text,
  ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT 'en',
  ADD COLUMN IF NOT EXISTS body_md text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS body_html text,
  ADD COLUMN IF NOT EXISTS published_at timestamptz,
  ADD COLUMN IF NOT EXISTS published_by uuid;

ALTER TABLE public.policy_versions
  ADD CONSTRAINT policy_versions_pkey PRIMARY KEY (id);

ALTER TABLE public.policy_versions
  ADD CONSTRAINT policy_versions_key_version_lang_uq
  UNIQUE (policy_key, version, language);

-- Only one current row per (policy_key, language)
CREATE UNIQUE INDEX IF NOT EXISTS policy_versions_current_uq
  ON public.policy_versions (policy_key, language)
  WHERE is_current = true;

GRANT SELECT ON public.policy_versions TO anon;
GRANT SELECT ON public.policy_versions TO authenticated;
GRANT ALL ON public.policy_versions TO service_role;

-- Append-only: block DELETE (audit/compliance)
CREATE OR REPLACE FUNCTION public.policy_versions_block_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'policy_versions is append-only (SOC 2 / consent audit). Use is_current=false to retire a version.';
END;
$$;

DROP TRIGGER IF EXISTS trg_policy_versions_block_delete ON public.policy_versions;
CREATE TRIGGER trg_policy_versions_block_delete
  BEFORE DELETE ON public.policy_versions
  FOR EACH ROW EXECUTE FUNCTION public.policy_versions_block_delete();

-- Public read RPC for the live policy
CREATE OR REPLACE FUNCTION public.get_current_policy(
  p_key text,
  p_language text DEFAULT 'en'
) RETURNS TABLE (
  id uuid,
  policy_key text,
  version text,
  language text,
  title text,
  summary text,
  body_md text,
  body_html text,
  effective_at timestamptz,
  checksum text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT pv.id, pv.policy_key, pv.version, pv.language, pv.title, pv.summary,
         pv.body_md, pv.body_html, pv.effective_at, pv.checksum
  FROM public.policy_versions pv
  WHERE pv.policy_key = p_key
    AND pv.language = p_language
    AND pv.is_current = true
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_current_policy(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_current_policy(text, text) TO anon, authenticated, service_role;

-- Admin-only publish RPC (atomically retires prior + inserts new + logs)
CREATE OR REPLACE FUNCTION public.publish_policy_version(
  p_key text,
  p_version text,
  p_language text,
  p_title text,
  p_summary text,
  p_body_md text,
  p_body_html text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_id uuid;
  v_checksum text;
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'admin role required' USING ERRCODE = '42501';
  END IF;
  IF coalesce(p_body_md, '') = '' THEN
    RAISE EXCEPTION 'body_md required' USING ERRCODE = '22023';
  END IF;

  v_checksum := encode(extensions.digest(p_body_md::text, 'sha256'::text), 'hex');

  UPDATE public.policy_versions
     SET is_current = false
   WHERE policy_key = p_key AND language = p_language AND is_current = true;

  INSERT INTO public.policy_versions (
    policy_key, version, language, title, summary, body_md, body_html,
    checksum, is_current, effective_at, published_at, published_by
  ) VALUES (
    p_key, p_version, p_language, p_title, p_summary, p_body_md, p_body_html,
    v_checksum, true, now(), now(), v_uid
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.publish_policy_version(text, text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.publish_policy_version(text, text, text, text, text, text, text) TO authenticated, service_role;

-- =========================================================================
-- PHASE 2: Framework CSV ingest provenance
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.reference_data_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name text NOT NULL,
  source_filename text NOT NULL,
  checksum text NOT NULL,
  row_count integer NOT NULL DEFAULT 0,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  ingested_by uuid,
  notes text
);

CREATE INDEX IF NOT EXISTS reference_data_sources_table_idx
  ON public.reference_data_sources (table_name, ingested_at DESC);

GRANT SELECT ON public.reference_data_sources TO authenticated;
GRANT ALL ON public.reference_data_sources TO service_role;

ALTER TABLE public.reference_data_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read reference_data_sources"
  ON public.reference_data_sources
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- =========================================================================
-- PHASE 1+2: Private storage buckets
-- =========================================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('policy-source-archive', 'policy-source-archive', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('framework-source-csv', 'framework-source-csv', false)
ON CONFLICT (id) DO NOTHING;

-- Admin-only read; service_role bypasses RLS
DROP POLICY IF EXISTS "Admins read policy-source-archive" ON storage.objects;
CREATE POLICY "Admins read policy-source-archive"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'policy-source-archive' AND public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins read framework-source-csv" ON storage.objects;
CREATE POLICY "Admins read framework-source-csv"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'framework-source-csv' AND public.has_role(auth.uid(), 'admin'));

-- =========================================================================
-- PHASE 3 helper: get_i18n_bundle RPC (curated common strings)
-- =========================================================================
-- The bundle is served via edge function, but expose a SECURITY DEFINER RPC
-- so the edge function can read with a single round-trip and so smoke tests
-- can assert directly. Returns rows joined to i18n_strings keyed by the
-- registered string key.
CREATE OR REPLACE FUNCTION public.get_i18n_bundle(
  p_locale text,
  p_namespace text DEFAULT 'common'
) RETURNS TABLE (
  key text,
  value text,
  source_hash text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.namespace || '.' || s.context AS key,
         t.value,
         t.source_hash
  FROM public.i18n_translations t
  JOIN public.i18n_strings s
    ON s.source_hash = t.source_hash AND s.namespace = t.namespace
  WHERE t.locale = p_locale
    AND t.namespace = p_namespace
    AND s.is_active = true
    AND s.context IS NOT NULL
    AND s.context <> '';
$$;

REVOKE ALL ON FUNCTION public.get_i18n_bundle(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_i18n_bundle(text, text) TO anon, authenticated, service_role;
