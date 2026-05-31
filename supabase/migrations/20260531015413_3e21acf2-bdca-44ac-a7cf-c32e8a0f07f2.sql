-- Fix: UGC translations Realtime leak
-- Replace table-level postgres_changes broadcasts with per-entity Broadcast topics
-- so anon subscribers no longer receive the global firehose of translations.

-- 1. Drop ugc_translations from supabase_realtime publication (stops postgres_changes broadcast)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='ugc_translations'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime DROP TABLE public.ugc_translations';
  END IF;
END $$;

-- 2. AFTER INSERT/UPDATE trigger: broadcast a minimal payload to a per-entity topic
CREATE OR REPLACE FUNCTION public.ugc_translations_broadcast()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IN ('qa_passed','approved') AND NEW.translated_text IS NOT NULL THEN
    PERFORM realtime.send(
      jsonb_build_object(
        'column_name', NEW.column_name,
        'target_locale', NEW.target_locale,
        'source_hash', NEW.source_hash,
        'translated_text', NEW.translated_text
      ),
      'ugc_translation',
      'ugc:' || NEW.entity_table || ':' || NEW.entity_id::text,
      false
    );
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.ugc_translations_broadcast() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS ugc_translations_broadcast_trg ON public.ugc_translations;
CREATE TRIGGER ugc_translations_broadcast_trg
AFTER INSERT OR UPDATE ON public.ugc_translations
FOR EACH ROW EXECUTE FUNCTION public.ugc_translations_broadcast();

-- 3. realtime.messages RLS: allow anon + authenticated to READ messages on ugc:* topics only.
--    Per-topic scoping eliminates the global fan-out: a subscriber only receives payloads
--    for the exact entity they joined.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='realtime' AND tablename='messages' AND policyname='ugc topic public read') THEN
    DROP POLICY "ugc topic public read" ON realtime.messages;
  END IF;
END $$;

CREATE POLICY "ugc topic public read"
ON realtime.messages
FOR SELECT
TO anon, authenticated
USING (
  (realtime.topic() LIKE 'ugc:%')
  AND (extension = 'broadcast')
);
