-- Drop the accessibility_training_completions feature.
--
-- Rationale: the "A11y Training" tracker was never wired to a writer — no code
-- path ever inserted a completion row, so the table stayed empty and the admin
-- grid's "A11y Training" column/percentage always read "Not yet" / 0%. The
-- feature is being removed end-to-end (admin UI + generated types + this table).
--
-- This does NOT touch the broader accessibility program (skip links, contrast,
-- accommodation form, i18n/preferred_language) — only the unused completions
-- tracker. Dropping the table cascades its RLS policies.
--
-- Introduced by migration 20260507013412 (section 3).

DROP TABLE IF EXISTS public.accessibility_training_completions CASCADE;
