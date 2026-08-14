-- ADR-0006: durable per-source material.
-- Store the parsed/fetched plain text of each deliverable submission (Figma/FigJam board, uploaded
-- file, link) on its OWN row, next to the source it came from — not in transient pipeline_state.
-- Captured once by the hand-off worker's checkpointed ingest stage, then read by the extractor.
-- Benefits: never re-fetched (idempotent ingest; re-produce reuses it), survives run completion /
-- worker death / resume, inspectable, and deleted with its source (no side cache to hunt for DSAR).
ALTER TABLE public.handoff_deliverable_submissions
  ADD COLUMN IF NOT EXISTS extracted_text text,
  ADD COLUMN IF NOT EXISTS extracted_at   timestamptz;

COMMENT ON COLUMN public.handoff_deliverable_submissions.extracted_text IS
  'Parsed/fetched plain text of this source (ingest stage; NULL = not yet ingested). Length-capped per ADR-0006. UNTRUSTED content: never rendered without sanitization, never treated as instructions.';
