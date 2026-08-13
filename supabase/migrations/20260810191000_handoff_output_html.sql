-- Hand-Off Production System (Phase B2/B3): allow the print-ready HTML output format.
-- Each produced version is stored as .md (canonical text) AND .html (self-contained, on-brand,
-- print-optimized -> the "Download PDF" path via browser Save-as-PDF; no headless renderer).
-- 'pdf' stays permitted for a future server-side PDF artifact.
ALTER TABLE public.handoff_output_files DROP CONSTRAINT IF EXISTS handoff_output_files_format_check;
ALTER TABLE public.handoff_output_files
  ADD CONSTRAINT handoff_output_files_format_check CHECK (format IN ('md','pdf','html'));

-- Allow text/html into the outputs bucket alongside md/plain/pdf.
UPDATE storage.buckets
   SET allowed_mime_types = ARRAY['text/markdown','text/plain','text/html','application/pdf']
 WHERE id = 'handoff-outputs';
