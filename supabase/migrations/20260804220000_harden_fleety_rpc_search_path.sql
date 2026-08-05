-- Harden the Fleety foundation RPCs (PRD v1.5 D-24 / UC-32).
--
-- The foundation migration (20260625120000) created fleety_observe_synonym and
-- fleety_load_user_memories as SECURITY DEFINER but with `SET search_path =
-- public`. A DEFINER function should pin `search_path = ''` so an attacker who
-- can create objects in a schema earlier on the caller's search_path cannot
-- shadow an unqualified reference and hijack execution. Both bodies already
-- fully schema-qualify every object (public.*), so pinning to '' is a safe,
-- behaviour-preserving change.
--
-- IDOR note (fleety_load_user_memories): it takes p_user_id and does NOT bind
-- to auth.uid(). That is intentional and correct HERE — it is a server-internal
-- function called by techfleet-chat with the SERVICE-ROLE client after the edge
-- function has already authenticated the user. service_role has no auth.uid(),
-- so an auth.uid() bind would break it. The IDOR control is therefore
-- least-privilege GRANTing: EXECUTE is granted to service_role ONLY and REVOKEd
-- from PUBLIC, so the authenticated/anon roles can never call it via PostgREST.
-- This migration re-asserts that grant scoping so it cannot silently drift.
--
-- Idempotent and safe to re-run.

-- =============================================================================
-- fleety_observe_synonym — pin search_path = '' (body unchanged, already
-- fully qualified). service_role-only.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.fleety_observe_synonym(
  p_user_term             text,
  p_canonical_term        text,
  p_canonical_entity_type text,
  p_threshold             int DEFAULT 5
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '' AS $$
BEGIN
  -- Skip terms that were rejected and are still suppressed.
  IF EXISTS (
    SELECT 1 FROM public.fleety_synonyms
    WHERE user_term = p_user_term
      AND canonical_term = p_canonical_term
      AND status = 'rejected'
      AND suppressed_until > now()
  ) THEN
    RETURN;
  END IF;

  INSERT INTO public.fleety_synonyms (user_term, canonical_term, canonical_entity_type)
  VALUES (p_user_term, p_canonical_term, p_canonical_entity_type)
  ON CONFLICT (user_term, canonical_term) DO UPDATE
    SET occurrence_count = public.fleety_synonyms.occurrence_count + 1,
        updated_at = now();

  UPDATE public.fleety_synonyms
  SET status = 'confirmed',
      auto_promoted_at = now()
  WHERE user_term = p_user_term
    AND canonical_term = p_canonical_term
    AND status = 'candidate'
    AND occurrence_count >= p_threshold;
END;
$$;

REVOKE ALL ON FUNCTION public.fleety_observe_synonym(text, text, text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fleety_observe_synonym(text, text, text, int) TO service_role;

-- =============================================================================
-- fleety_load_user_memories — pin search_path = '' (body unchanged, already
-- fully qualified). service_role-only (IDOR control — see header note).
-- =============================================================================
CREATE OR REPLACE FUNCTION public.fleety_load_user_memories(p_user_id uuid)
RETURNS TABLE(memory_key text, memory_value text, category text, confidence numeric)
LANGUAGE sql SECURITY DEFINER
SET search_path = '' AS $$
  SELECT memory_key, memory_value, category, confidence
  FROM public.fleety_user_memory
  WHERE user_id = p_user_id
    AND expires_at > now()
  ORDER BY category, memory_key;
$$;

REVOKE ALL ON FUNCTION public.fleety_load_user_memories(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fleety_load_user_memories(uuid) TO service_role;
