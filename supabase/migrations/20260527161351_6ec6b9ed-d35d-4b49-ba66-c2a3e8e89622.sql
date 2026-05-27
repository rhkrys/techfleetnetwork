
-- Fix: announcements stores rich text in body_html, not body
DELETE FROM public.i18n_content_registry WHERE table_name='announcements' AND column_name='body';

INSERT INTO public.i18n_content_registry (table_name, column_name, content_format, priority, max_chars, is_pii)
VALUES ('announcements', 'body_html', 'html', 'hot', 20000, false)
ON CONFLICT (table_name, column_name) DO UPDATE
  SET content_format = EXCLUDED.content_format,
      priority = EXCLUDED.priority,
      max_chars = EXCLUDED.max_chars,
      is_active = true;

-- Make sure write-side trigger covers announcements
DROP TRIGGER IF EXISTS trg_ugc_translate_announcements ON public.announcements;
CREATE TRIGGER trg_ugc_translate_announcements
AFTER INSERT OR UPDATE ON public.announcements
FOR EACH ROW EXECUTE FUNCTION public.enqueue_ugc_translation_jobs();
