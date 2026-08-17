-- One-time cleanup for the SPF->KB URL-collision fix.
--
-- Old behavior: spf-kb.ts built a slug-ONLY deep-link (…/explore/#item/<slug>) as each KB row's
-- URL, and knowledge_base de-dups on url (UNIQUE). Slugs are not unique across the 12 SPF entity
-- types, so distinct entities (e.g. a `skill` and a `practice` both "facilitation") collapsed onto
-- one row — overwriting each other (data loss) and re-embedding forever (backfill never converged).
--
-- Fix (fleety-embed/spf-kb.ts): the URL now includes the entity type as a query param BEFORE the
-- hash — …/explore/?e=<entity_type>#item/<slug> — which is unique per entity yet byte-identical in
-- location.hash, so the SPA still navigates to the same page. Each entity now gets its own KB row.
--
-- This migration removes the stale OLD-format rows so the fixed backfill repopulates cleanly. It
-- matches ONLY the old slug-only pattern (…/explore/#item/…); the new format has `?e=…` between
-- `/explore/` and `#item/`, so it is never touched. No-op where none exist (e.g. CI).
--
-- AFTER deploy, run once to repopulate every entity (converges to spf:0):
--   POST /functions/v1/fleety-embed {"mode":"backfill","table":"spf","limit":25}

DELETE FROM public.knowledge_base
WHERE url LIKE '%/explore/#item/%';
