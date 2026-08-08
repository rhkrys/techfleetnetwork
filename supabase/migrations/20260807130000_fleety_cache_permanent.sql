-- ============================================================================
-- Fleety response cache -> PERMANENT + GROWING, and fix the latent 768/1536 bug.
-- ============================================================================
--
-- Two problems fixed together (they share the same functions/table):
--
--   (A) DIMENSION BUG (latent, silent). fleety_response_cache.query_embedding is
--       vector(1536) — from the original 1536-d gateway embeddings. Fleety now
--       embeds queries at 768 (gemini-embedding-001 @768, _shared/gemini-embed.ts;
--       the knowledge_base itself moved to vector(768) back in 20260503202421).
--       So every semantic store/lookup hit a dimension mismatch and FAILED — the
--       edge function swallowed it as "L3 cache lookup failed" and fell through to
--       the model. The semantic cache has therefore never matched since the 768
--       migration. Re-space the column + functions + ANN index to 768.
--
--   (B) NOT PERMANENT. Both lookups filtered `last_used_at >= now() - 7 days`, so
--       entries stopped being served after a week and the cache could not grow
--       over time. Remove the time filter so the cache PERSISTS and GROWS.
--
-- Why "forever" is SAFE here (the guardrails that make permanence correct):
--   * kb_version scoping — every lookup requires kb_version = current version.
--     Admin content edits / ingest call bump_kb_version(), so answers built
--     against old content stop matching automatically (see F-COST-005). Permanent
--     storage never serves stale facts; superseded rows simply go dormant.
--   * thumbs-down purge — trg_fleety_feedback_purge_cache deletes any row a user
--     rated -1 (see F-COST-006), so bad answers can't live forever.
-- No time-based eviction remains; growth is bounded in practice by the number of
-- distinct questions asked. (Dormant old-kb_version rows are harmless — never
-- served — and can be vacuumed by a future maintenance job if ever needed.)
--
-- Safety: idempotent (CREATE OR REPLACE / IF EXISTS); no RLS or grant weakening
-- (functions stay SECURITY DEFINER, service_role-only, search_path pinned).
-- ----------------------------------------------------------------------------

BEGIN;

-- (A) Re-space the embedding column to 768. Existing 1536-d vectors are a
-- different, unusable vector space, so null them; each row re-stores a 768-d
-- embedding the next time it is served (text/answer are retained).
DROP INDEX IF EXISTS public.idx_fleety_response_cache_embedding;

ALTER TABLE public.fleety_response_cache
  ALTER COLUMN query_embedding TYPE extensions.vector(768) USING NULL;

-- HNSW to match the KB's index (better recall for a growing set than ivfflat,
-- and no lists/training assumptions as the row count climbs).
CREATE INDEX IF NOT EXISTS idx_fleety_response_cache_embedding
  ON public.fleety_response_cache
  USING hnsw (query_embedding extensions.vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- (A)+(B) Semantic lookup: 768-d param, and NO 7-day freshness filter.
CREATE OR REPLACE FUNCTION public.fleety_cache_semantic_lookup(
  _query_embedding extensions.vector(768),
  _audience text,
  _max_distance double precision DEFAULT 0.05  -- ~0.95 cosine sim
)
RETURNS TABLE (
  query_hash text,
  response_md text,
  sources jsonb,
  tier text,
  similarity double precision
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  current_v bigint;
BEGIN
  SELECT version INTO current_v FROM public.fleety_kb_version WHERE id = true;

  RETURN QUERY
  SELECT c.query_hash,
         c.response_md,
         c.sources,
         c.tier,
         (1 - (c.query_embedding <=> _query_embedding))::double precision AS similarity
    FROM public.fleety_response_cache c
   WHERE c.audience = _audience
     AND c.kb_version = current_v            -- staleness guard (permanence-safe)
     AND c.query_embedding IS NOT NULL
     AND (c.query_embedding <=> _query_embedding) <= _max_distance
   ORDER BY c.query_embedding <=> _query_embedding ASC
   LIMIT 1;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fleety_cache_semantic_lookup(extensions.vector, text, double precision) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fleety_cache_semantic_lookup(extensions.vector, text, double precision) TO service_role;

-- (A) Cache store: 768-d embedding param (behavior otherwise unchanged).
CREATE OR REPLACE FUNCTION public.fleety_cache_store(
  _query_hash text,
  _query_text text,
  _audience text,
  _response_md text,
  _sources jsonb,
  _tier text,
  _query_embedding extensions.vector(768) DEFAULT NULL,
  _turn_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  current_v bigint;
BEGIN
  SELECT version INTO current_v FROM public.fleety_kb_version WHERE id = true;

  INSERT INTO public.fleety_response_cache
    (query_hash, query_text, audience, kb_version, response_md, sources, tier,
     query_embedding, last_turn_id)
  VALUES
    (_query_hash, _query_text, _audience, current_v, _response_md, _sources, _tier,
     _query_embedding, _turn_id)
  ON CONFLICT (query_hash) DO UPDATE
    SET response_md  = EXCLUDED.response_md,
        sources      = EXCLUDED.sources,
        tier         = EXCLUDED.tier,
        kb_version   = EXCLUDED.kb_version,
        query_embedding = COALESCE(EXCLUDED.query_embedding, public.fleety_response_cache.query_embedding),
        last_turn_id = EXCLUDED.last_turn_id,
        last_used_at = now();
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fleety_cache_store(text, text, text, text, jsonb, text, extensions.vector, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fleety_cache_store(text, text, text, text, jsonb, text, extensions.vector, uuid) TO service_role;

-- (B) Exact-hash lookup: NO 7-day freshness filter (permanence). kb_version
-- scoping retained.
CREATE OR REPLACE FUNCTION public.fleety_cache_lookup(
  _query_hash text,
  _audience text
)
RETURNS TABLE (
  response_md text,
  sources jsonb,
  tier text,
  kb_version bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  current_v bigint;
BEGIN
  SELECT version INTO current_v FROM public.fleety_kb_version WHERE id = true;

  RETURN QUERY
  UPDATE public.fleety_response_cache c
     SET hits = hits + 1, last_used_at = now()
   WHERE c.query_hash = _query_hash
     AND c.audience = _audience
     AND c.kb_version = current_v
  RETURNING c.response_md, c.sources, c.tier, c.kb_version;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fleety_cache_lookup(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fleety_cache_lookup(text, text) TO service_role;

-- ---------------------------------------------------------------------------
-- BDD coverage
-- ---------------------------------------------------------------------------
INSERT INTO public.bdd_scenarios
  (scenario_id, feature_area, feature_area_number, title, gherkin, status, test_type, test_file, notes)
VALUES
  ('FLEETY-011', 'Fleety', 30,
   'The response cache is permanent and grows over time',
   'Feature: Permanent, growing response cache\n  Scenario: a cached answer is served regardless of age\n    Given a cached answer stored months ago for the current kb_version and audience\n    When a matching question is asked again\n    Then fleety_cache_semantic_lookup returns it with no time-based expiry\n    And no AI (Groq) call is made\n  Scenario: growth is bounded only by distinct questions, not by a TTL\n    Given many distinct questions have been answered and stored\n    Then every row remains eligible to serve until its kb_version is superseded or it is thumbs-down purged',
   'implemented', 'unit', 'src/test/smoke/fleety-cache-permanence.smoke.test.ts',
   'Removes the 7-day last_used_at filter from fleety_cache_semantic_lookup and fleety_cache_lookup so the cache persists/grows. Permanence stays safe via kb_version scoping (F-COST-005) and the thumbs-down purge (F-COST-006).'),
  ('FLEETY-012', 'Fleety', 30,
   'The response cache embeds at 768 dims, matching the query embedding',
   'Feature: Cache embedding dimension matches the live model\n  Scenario: cache and query share one vector space\n    Given Fleety embeds queries at 768 dims (gemini-embedding-001)\n    And the cache column was previously vector(1536) (a different, unusable space)\n    When a query embedding is stored to or matched against the cache\n    Then the cache column and functions use vector(768)\n    And the semantic lookup no longer fails on a dimension mismatch',
   'implemented', 'unit', 'src/test/smoke/fleety-cache-permanence.smoke.test.ts',
   'Latent bug: fleety_response_cache.query_embedding stayed vector(1536) after the KB moved to 768, so every semantic store/lookup silently failed. Migrated column + fleety_cache_store + fleety_cache_semantic_lookup + ANN index (now HNSW) to 768.')
ON CONFLICT (scenario_id) DO UPDATE SET
  title = EXCLUDED.title, gherkin = EXCLUDED.gherkin, status = EXCLUDED.status,
  test_type = EXCLUDED.test_type, test_file = EXCLUDED.test_file,
  feature_area = EXCLUDED.feature_area, feature_area_number = EXCLUDED.feature_area_number,
  notes = EXCLUDED.notes, updated_at = now();

COMMIT;
