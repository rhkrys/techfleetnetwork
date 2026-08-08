-- Fleety AI Rearchitecture — foundation schema
-- Source: Fleety-PRD-v1.3 (Section 13) + Fleety-SAD-v1.0 (Section 2 DDL, 2.6 RPCs).
-- Idempotent and safe to re-run. Apply against the production project with
-- `supabase db push`. Ordered for safe sequential execution.
--
-- This migration also FOLDS IN the fix for the 2026-06-25 recruiting-center
-- outage. Reads of project_applications / admin_banners (and any table whose
-- RLS policy calls a helper in the `private` schema) returned
--   42501 "permission denied for schema private"  ->  HTTP 403
-- because the authenticated/anon roles were never granted USAGE on the
-- `private` schema on the rebuilt project. private.* functions are NOT exposed
-- through PostgREST (only the `public` schema is), so granting EXECUTE here
-- does not widen the API surface — it only lets RLS policies that reference
-- private helpers evaluate for normal users. RLS still enforces row access.

-- =============================================================================
-- 0. Recruiting-center fix — restore private-schema access for RLS evaluation.
-- =============================================================================
-- REPAIR (audit H3/H4, 2026-08-08): the `private` schema exists on the live
-- project (Lovable-era) but was never created in a migration, so a fresh
-- `supabase db reset` failed here ("schema private does not exist"). Idempotent
-- create — no-op on any DB where it already exists.
CREATE SCHEMA IF NOT EXISTS private;
GRANT USAGE ON SCHEMA private TO authenticated, anon, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA private TO authenticated, anon, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA private
  GRANT EXECUTE ON FUNCTIONS TO authenticated, anon, service_role;

-- =============================================================================
-- 1. knowledge_base — add columns, swap IVFFlat -> HNSW index (SAD 2.1, D-10)
-- =============================================================================
ALTER TABLE public.knowledge_base
  ADD COLUMN IF NOT EXISTS embedding_model text,
  ADD COLUMN IF NOT EXISTS fetched_at      timestamptz,
  ADD COLUMN IF NOT EXISTS content_hash    text,        -- used by guide-ingest (SAD 3.3)
  ADD COLUMN IF NOT EXISTS archived        boolean NOT NULL DEFAULT false;

-- Mark existing rows with the model they were embedded under (pre-unification).
-- The one-time backfill (fleety-embed mode=backfill) re-embeds these to
-- text-embedding-004 and flips embedding_model accordingly (D-01).
UPDATE public.knowledge_base
  SET embedding_model = 'gemini-embedding-001'
  WHERE embedding_model IS NULL AND embedding IS NOT NULL;

-- Replace the old IVFFlat index with HNSW (better concurrent-read performance).
-- NOTE: CREATE INDEX takes a brief write lock on knowledge_base. The table is
-- small (~hundreds of rows) so this is sub-second; run off-peak regardless.
DROP INDEX IF EXISTS public.knowledge_base_embedding_idx;

CREATE INDEX IF NOT EXISTS knowledge_base_embedding_hnsw_idx
  ON public.knowledge_base USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Composite partial index for the admin Gaps panel (zero-hit turns).
CREATE INDEX IF NOT EXISTS fleety_turn_signals_gap_query_idx
  ON public.fleety_turn_signals (created_at DESC, audience, intent)
  WHERE kb_hit_count = 0;

-- =============================================================================
-- Shared trigger function for updated_at maintenance.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- =============================================================================
-- 2. fleety_synonyms — new table (SAD 2.2, D-05)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.fleety_synonyms (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_term             text        NOT NULL,
  canonical_term        text        NOT NULL,
  canonical_entity_type text,
  occurrence_count      integer     NOT NULL DEFAULT 1
                                    CHECK (occurrence_count >= 1),
  status                text        NOT NULL DEFAULT 'candidate'
                                    CHECK (status IN ('candidate','confirmed','rejected')),
  auto_promoted_at      timestamptz,
  suppressed_until      timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_term, canonical_term)
);

CREATE INDEX IF NOT EXISTS fleety_synonyms_status_idx
  ON public.fleety_synonyms (status, occurrence_count);

ALTER TABLE public.fleety_synonyms ENABLE ROW LEVEL SECURITY;

-- Only the service role touches synonyms (observation + retrieval happen
-- server-side in techfleet-chat). No member/anon access.
DROP POLICY IF EXISTS fleety_synonyms_service_only ON public.fleety_synonyms;
CREATE POLICY fleety_synonyms_service_only ON public.fleety_synonyms
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP TRIGGER IF EXISTS fleety_synonyms_updated_at ON public.fleety_synonyms;
CREATE TRIGGER fleety_synonyms_updated_at
  BEFORE UPDATE ON public.fleety_synonyms
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================================================
-- 3. fleety_user_memory — new table (SAD 2.3, D-06)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.fleety_user_memory (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid         NOT NULL
                               REFERENCES auth.users(id) ON DELETE CASCADE,
  memory_key      text         NOT NULL,
  memory_value    text         NOT NULL,
  category        text         NOT NULL
                               CHECK (category IN
                                 ('role','project','preference','struggle','achievement')),
  confidence      numeric(3,2) NOT NULL DEFAULT 0.80
                               CHECK (confidence >= 0 AND confidence <= 1),
  source_turn_id  uuid,
  expires_at      timestamptz  NOT NULL DEFAULT (now() + interval '90 days'),
  created_at      timestamptz  NOT NULL DEFAULT now(),
  updated_at      timestamptz  NOT NULL DEFAULT now(),
  UNIQUE (user_id, memory_key)
);

CREATE INDEX IF NOT EXISTS fleety_user_memory_user_active_idx
  ON public.fleety_user_memory (user_id, expires_at);

ALTER TABLE public.fleety_user_memory ENABLE ROW LEVEL SECURITY;

-- Members may read their own memories (future UI); service role does the
-- extraction, injection and cleanup.
DROP POLICY IF EXISTS fleety_user_memory_read_own ON public.fleety_user_memory;
CREATE POLICY fleety_user_memory_read_own ON public.fleety_user_memory
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS fleety_user_memory_service_all ON public.fleety_user_memory;
CREATE POLICY fleety_user_memory_service_all ON public.fleety_user_memory
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP TRIGGER IF EXISTS fleety_user_memory_updated_at ON public.fleety_user_memory;
CREATE TRIGGER fleety_user_memory_updated_at
  BEFORE UPDATE ON public.fleety_user_memory
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================================================
-- 4. fleety_turn_signals — add observability columns (SAD 2.4, D-17a)
-- =============================================================================
ALTER TABLE public.fleety_turn_signals
  ADD COLUMN IF NOT EXISTS prompt_version   text,
  ADD COLUMN IF NOT EXISTS embedding_failed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS synonym_expanded boolean NOT NULL DEFAULT false;
-- Existing rows keep prompt_version = NULL (correct historical value).

-- =============================================================================
-- 5. fleety_examples — track nugget promotion provenance (SAD 2.5, D-07)
-- =============================================================================
ALTER TABLE public.fleety_examples
  ADD COLUMN IF NOT EXISTS promoted_from_turn_id uuid,
  ADD COLUMN IF NOT EXISTS promoted_at           timestamptz;

-- =============================================================================
-- 6. New RPCs (SAD 2.6)
-- =============================================================================

-- fleety_observe_synonym — UPSERT a synonym observation, auto-promote at
-- threshold. Server-internal: EXECUTE granted to service_role only.
CREATE OR REPLACE FUNCTION public.fleety_observe_synonym(
  p_user_term             text,
  p_canonical_term        text,
  p_canonical_entity_type text,
  p_threshold             int DEFAULT 5
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
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

-- fleety_load_user_memories — return non-expired memories for a user.
-- SECURITY DEFINER + takes p_user_id, so it must NOT be exposed to the
-- authenticated role (that would be an IDOR: any user could read any other
-- user's memories by passing a different id). techfleet-chat calls it with the
-- service-role client. EXECUTE granted to service_role only.
CREATE OR REPLACE FUNCTION public.fleety_load_user_memories(p_user_id uuid)
RETURNS TABLE(memory_key text, memory_value text, category text, confidence numeric)
LANGUAGE sql SECURITY DEFINER
SET search_path = public AS $$
  SELECT memory_key, memory_value, category, confidence
  FROM public.fleety_user_memory
  WHERE user_id = p_user_id
    AND expires_at > now()
  ORDER BY category, memory_key;
$$;

REVOKE ALL ON FUNCTION public.fleety_load_user_memories(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fleety_load_user_memories(uuid) TO service_role;
