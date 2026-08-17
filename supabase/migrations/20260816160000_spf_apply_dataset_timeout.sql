-- Fix: the SPF atomic per-dataset swap (spf_apply_dataset, ADR-0002) was being killed by the
-- service_role connection's short statement_timeout — the career-transitioning import failed with
-- "canceling statement due to statement timeout". The swap does DELETE + bulk INSERT of the
-- normalized snapshot AND stores the verbatim raw payload (provenance) in one transaction, which
-- can exceed a low default. Give the function its own generous statement_timeout so a legitimate
-- atomic swap can't be truncated. Root-cause fix at the DB layer (no client-side band-aid).
--
-- Identical body to 20260810161000_spf_apply_dataset_rpc.sql — the ONLY change is the added
-- `SET statement_timeout = '120s'` function attribute. Grants are unchanged (service_role only).

CREATE OR REPLACE FUNCTION public.spf_apply_dataset(
  p_entity_type  text,
  p_dataset      text,
  p_spf_version  text,
  p_checksum     text,
  p_record_count integer,
  p_raw          jsonb,
  p_rows         jsonb
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '120s'   -- headroom for the atomic swap; was inheriting a too-short default
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
