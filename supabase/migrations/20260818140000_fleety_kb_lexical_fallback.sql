-- Fleety 2.2-D — lexical KB retrieval fallback (finally builds UC-22).
--
-- ROOT CAUSE this fixes: Fleety's KB retrieval only ran when a per-query Gemini embedding
-- succeeded. When the (free-tier) embedding quota tripped (HTTP 429) or the provider was down,
-- embedQuery() returned null, the semantic search was skipped, and there was NO fallback — so
-- Fleety went blind to the ENTIRE corpus at once (skills, practices, careers, everything) until
-- the quota reset. This is the single point of failure.
--
-- FIX: a lexical search over the SAME knowledge_base that needs NO embedding — Postgres
-- full-text search. Terms are OR-combined (so a conversational question matches rows containing
-- ANY salient term, not only rows containing ALL of them — the AND-of-terms brittleness that also
-- made the framework FTS miss natural-language queries). The caller uses this whenever the query
-- embedding is unavailable OR semantic search returns zero hits, so the documents (already embedded
-- once, and independently searchable by text) are never unreachable because of one live API call.
--
-- SECURITY: SECURITY DEFINER + fixed search_path; EXECUTE revoked from anon/authenticated/PUBLIC
-- and granted only to service_role — identical posture to fleety_kb_semantic_search after the
-- 20260816200000 least-privilege lockdown. Input is sanitized to [a-z0-9 ] before it reaches
-- to_tsquery (no tsquery-syntax injection, no operator chars).

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- GIN index matching the search expression EXACTLY so the @@ filter is index-assisted
-- (keeps the fallback fast as the KB grows; the fallback path must not become a latency cliff).
CREATE INDEX IF NOT EXISTS idx_kb_fts_en
  ON public.knowledge_base
  USING gin (to_tsvector('english', coalesce(title, '') || ' ' || coalesce(content, '')));

CREATE OR REPLACE FUNCTION public.fleety_kb_lexical_search(
  p_query text,
  p_limit int DEFAULT 6
)
RETURNS TABLE(id uuid, url text, title text, content text, similarity numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH terms AS (
    -- Sanitize to alphanumerics + spaces, split to words, keep words >= 3 chars, dedupe.
    SELECT array_agg(DISTINCT w) AS ws
    FROM unnest(
      regexp_split_to_array(lower(regexp_replace(coalesce(p_query, ''), '[^a-z0-9 ]', ' ', 'g')), '\s+')
    ) AS w
    WHERE length(w) >= 3
  ),
  q AS (
    -- OR-combine the terms so a natural-language question matches rows containing ANY of them.
    SELECT to_tsquery('english', array_to_string(ws, ' | ')) AS tsq
    FROM terms
    WHERE ws IS NOT NULL AND array_length(ws, 1) >= 1
  )
  SELECT k.id, k.url, k.title, k.content,
         ts_rank(
           to_tsvector('english', coalesce(k.title, '') || ' ' || coalesce(k.content, '')),
           q.tsq
         )::numeric AS similarity
    FROM public.knowledge_base k, q
   WHERE to_tsvector('english', coalesce(k.title, '') || ' ' || coalesce(k.content, '')) @@ q.tsq
   ORDER BY similarity DESC
   LIMIT GREATEST(p_limit, 1);
$$;

REVOKE EXECUTE ON FUNCTION public.fleety_kb_lexical_search(text, integer) FROM anon, authenticated, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.fleety_kb_lexical_search(text, integer) TO service_role;
