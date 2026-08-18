-- A1 handbook chunking support: a nullable content_hash on knowledge_base so guide-ingest can skip
-- re-embedding unchanged pages (it now writes MULTIPLE chunk rows per page, so the old
-- content-equality check per row no longer identifies an unchanged page). The hash is of the full
-- page markdown, stored on every chunk row of that page; guide-ingest compares it to decide whether
-- to rewrite + re-embed. Purely additive; existing rows get NULL (treated as "changed" once).
ALTER TABLE public.knowledge_base ADD COLUMN IF NOT EXISTS content_hash text;
