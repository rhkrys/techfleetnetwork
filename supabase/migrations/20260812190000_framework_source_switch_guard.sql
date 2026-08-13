-- Wave 6 (cutover safety, Workstream A): a GUARDED framework-source switch.
--
-- The graph facade (ADR-0003) reads framework_source_config.active_source; flipping it to 'spf'
-- repoints Fleety RAG + Journeys + search onto the SPF snapshot. Today that flip is an unguarded
-- UPDATE: if it happens while the snapshot is empty or only partially synced, framework_entity_v
-- returns (nearly) zero rows and the whole framework graph blanks out — a SEV1. This adds the
-- empty-graph / partial-snapshot guard the cutover plan requires, and makes rollback trivial.

-- Readiness signal for the canary + monitoring: is the SPF snapshot safe to serve? Non-empty and
-- broad enough to not be a single-dataset partial sync. (A strict count-parity vs the reference
-- source is intentionally NOT required — SPF is a deliberately richer/different taxonomy; the guard
-- protects against a BLANK/partial snapshot, not against legitimate divergence.)
CREATE OR REPLACE FUNCTION public.framework_spf_snapshot_ready()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT count(*) > 0 AND count(DISTINCT entity_type) >= 3
  FROM public.spf_entity WHERE is_active;
$$;
REVOKE ALL ON FUNCTION public.framework_spf_snapshot_ready() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.framework_spf_snapshot_ready() TO authenticated, service_role;

-- The ONLY supported way to switch the framework read source. Guards the DANGEROUS direction
-- (-> spf) against an empty/partial snapshot; the SAFE direction (-> reference, i.e. rollback) is
-- ALWAYS allowed and instant, so an operator can always recover. Records who/when via
-- updated_by/updated_at on the singleton config row.
CREATE OR REPLACE FUNCTION public.framework_set_source(
  p_target text,
  p_spf_version text DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_count bigint;
  v_types bigint;
BEGIN
  IF p_target NOT IN ('reference', 'spf') THEN
    RAISE EXCEPTION 'framework source must be reference or spf, got %', p_target
      USING ERRCODE = '22023';
  END IF;

  IF p_target = 'spf' THEN
    SELECT count(*), count(DISTINCT entity_type) INTO v_count, v_types
      FROM public.spf_entity WHERE is_active;
    IF v_count = 0 THEN
      RAISE EXCEPTION
        'refusing to activate SPF source: snapshot is EMPTY (would blank the framework graph for Fleety/Journeys/search)'
        USING ERRCODE = '23514';
    END IF;
    IF v_types < 3 THEN
      RAISE EXCEPTION
        'refusing to activate SPF source: snapshot covers only % entity type(s) — looks like a partial sync', v_types
        USING ERRCODE = '23514';
    END IF;
  END IF;

  UPDATE public.framework_source_config
     SET active_source = p_target,
         spf_active_version = CASE WHEN p_target = 'spf'
                                   THEN COALESCE(p_spf_version, spf_active_version)
                                   ELSE spf_active_version END,
         updated_at = now(),
         updated_by = auth.uid()
   WHERE id = 1;

  RETURN p_target;
END $$;
REVOKE ALL ON FUNCTION public.framework_set_source(text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.framework_set_source(text, text) TO service_role;

COMMENT ON FUNCTION public.framework_set_source(text, text) IS
  'Cutover-safe framework source switch (Workstream A). ->spf is guarded against an empty/partial '
  'snapshot; ->reference (rollback) is always allowed. Service-role only; the ops runbook + canary '
  'call this rather than UPDATE-ing framework_source_config directly.';
