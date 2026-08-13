-- SPF data layer — atomic per-dataset swap RPC (ADR-0002). Part of the EXPAND step.
-- The edge function (spf-sync) does the untrusted work (SSRF-guarded fetch + contract
-- validation); this RPC does the ATOMIC write: within one transaction it records provenance
-- and replaces the normalized rows for one entity_type, so no consumer can ever observe a
-- half-written dataset (fail-closed: the edge fn only calls this AFTER validation passes).
-- service_role only. Idempotent / re-runnable. No consumer reads spf_entity yet (Phase A2/A3).

CREATE OR REPLACE FUNCTION public.spf_apply_dataset(
  p_entity_type  text,   -- normalized singular type, e.g. 'deliverable', 'handoff_component'
  p_dataset      text,   -- SPF dataset key for provenance, e.g. 'handoff-deliverables-map'
  p_spf_version  text,   -- pinned API version, e.g. 'v1'
  p_checksum     text,   -- SHA-256 of the fetched payload
  p_record_count integer,
  p_raw          jsonb,  -- verbatim fetched array (provenance / rollback source)
  p_rows         jsonb   -- normalized array of {slug,name,description,category,data}
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  n integer;
BEGIN
  -- Provenance: keep exactly one active raw row per (dataset, version).
  UPDATE public.spf_datasets_raw
     SET is_active = false
   WHERE entity = p_dataset AND spf_version = p_spf_version AND is_active;

  INSERT INTO public.spf_datasets_raw (entity, spf_version, checksum, record_count, raw, is_active)
  VALUES (p_dataset, p_spf_version, p_checksum, p_record_count, p_raw, true)
  ON CONFLICT (entity, spf_version, checksum)
  DO UPDATE SET is_active = true, record_count = EXCLUDED.record_count,
                raw = EXCLUDED.raw, fetched_at = now();

  -- Atomic swap of the normalized snapshot for this entity_type (delete+insert in one txn).
  DELETE FROM public.spf_entity WHERE entity_type = p_entity_type;

  INSERT INTO public.spf_entity (entity_type, slug, name, description, category, data, is_active, spf_version)
  SELECT p_entity_type,
         r->>'slug',
         r->>'name',
         NULLIF(r->>'description', ''),
         NULLIF(r->>'category', ''),
         COALESCE(r->'data', '{}'::jsonb),
         true,
         p_spf_version
  FROM jsonb_array_elements(p_rows) AS r;

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.spf_apply_dataset(text, text, text, text, integer, jsonb, jsonb)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.spf_apply_dataset(text, text, text, text, integer, jsonb, jsonb)
  TO service_role;

COMMENT ON FUNCTION public.spf_apply_dataset(text, text, text, text, integer, jsonb, jsonb) IS
  'Atomic per-dataset SPF snapshot swap (ADR-0002): records provenance + replaces spf_entity rows for one entity_type in a single transaction. Called by the spf-sync edge fn only after contract validation. service_role only.';
