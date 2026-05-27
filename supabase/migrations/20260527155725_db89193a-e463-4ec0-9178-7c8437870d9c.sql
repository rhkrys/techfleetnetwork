
-- =====================================================================
-- I18N PRE-WARMED FULL-COVERAGE + UGC TRANSLATION FOUNDATION
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. i18n_strings — catalog of source (English) strings
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.i18n_strings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_hash     text NOT NULL UNIQUE,
  source_text     text NOT NULL,
  namespace       text NOT NULL DEFAULT 'dom',
  context         text,
  max_length      integer,
  placeholders    jsonb DEFAULT '[]'::jsonb,
  do_not_translate boolean NOT NULL DEFAULT false,
  first_seen_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  seen_count      bigint NOT NULL DEFAULT 1,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_i18n_strings_ns_active ON public.i18n_strings(namespace, is_active);
CREATE INDEX IF NOT EXISTS idx_i18n_strings_last_seen ON public.i18n_strings(last_seen_at);

GRANT SELECT ON public.i18n_strings TO anon, authenticated;
GRANT ALL ON public.i18n_strings TO service_role;
ALTER TABLE public.i18n_strings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "i18n_strings public read" ON public.i18n_strings FOR SELECT USING (true);
CREATE POLICY "i18n_strings admin write" ON public.i18n_strings FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- ---------------------------------------------------------------------
-- 2. Extend i18n_translations with QA + status columns
-- ---------------------------------------------------------------------
ALTER TABLE public.i18n_translations
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'qa_passed'
    CHECK (status IN ('pending','qa_passed','qa_failed','flagged','approved')),
  ADD COLUMN IF NOT EXISTS qa_report jsonb,
  ADD COLUMN IF NOT EXISTS is_admin_edited boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'ai',
  ADD COLUMN IF NOT EXISTS quality_score numeric;

CREATE INDEX IF NOT EXISTS idx_i18n_translations_locale_updated
  ON public.i18n_translations(locale, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_i18n_translations_admin_edited
  ON public.i18n_translations(locale) WHERE is_admin_edited = true;

-- ---------------------------------------------------------------------
-- 3. i18n_snapshots — gzipped served payload per locale × version
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.i18n_snapshots (
  locale        text NOT NULL,
  version       bigint NOT NULL,
  payload_gzip  bytea NOT NULL,
  entry_count   integer NOT NULL DEFAULT 0,
  byte_size     integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (locale, version)
);
CREATE INDEX IF NOT EXISTS idx_i18n_snapshots_locale_latest
  ON public.i18n_snapshots(locale, version DESC);

GRANT SELECT ON public.i18n_snapshots TO anon, authenticated;
GRANT ALL ON public.i18n_snapshots TO service_role;
ALTER TABLE public.i18n_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "i18n_snapshots public read" ON public.i18n_snapshots FOR SELECT USING (true);

-- ---------------------------------------------------------------------
-- 4. i18n_prewarm_jobs — operational queue
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.i18n_prewarm_jobs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  string_id     uuid NOT NULL REFERENCES public.i18n_strings(id) ON DELETE CASCADE,
  locale        text NOT NULL,
  priority      text NOT NULL DEFAULT 'batch' CHECK (priority IN ('realtime','batch','backfill')),
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','done','failed')),
  attempts      integer NOT NULL DEFAULT 0,
  last_error    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (string_id, locale, status)
);
CREATE INDEX IF NOT EXISTS idx_i18n_prewarm_pending
  ON public.i18n_prewarm_jobs(priority, created_at) WHERE status = 'pending';

GRANT SELECT ON public.i18n_prewarm_jobs TO authenticated;
GRANT ALL ON public.i18n_prewarm_jobs TO service_role;
ALTER TABLE public.i18n_prewarm_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "i18n_prewarm admin read" ON public.i18n_prewarm_jobs FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- ---------------------------------------------------------------------
-- 5. i18n_qa_failures — audit trail of rejected translations
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.i18n_qa_failures (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  string_id     uuid REFERENCES public.i18n_strings(id) ON DELETE CASCADE,
  entity_table  text,
  entity_id     uuid,
  column_name   text,
  locale        text NOT NULL,
  source_text   text NOT NULL,
  attempted_text text,
  gate_failed   text NOT NULL,
  qa_report     jsonb NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_i18n_qa_failures_locale ON public.i18n_qa_failures(locale, created_at DESC);

GRANT SELECT ON public.i18n_qa_failures TO authenticated;
GRANT ALL ON public.i18n_qa_failures TO service_role;
ALTER TABLE public.i18n_qa_failures ENABLE ROW LEVEL SECURITY;
CREATE POLICY "i18n_qa_failures admin read" ON public.i18n_qa_failures FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- ---------------------------------------------------------------------
-- 6. i18n_coverage_audit — daily per-locale coverage snapshot
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.i18n_coverage_audit (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  locale          text NOT NULL,
  total_strings   integer NOT NULL DEFAULT 0,
  translated      integer NOT NULL DEFAULT 0,
  qa_passed       integer NOT NULL DEFAULT 0,
  qa_failed       integer NOT NULL DEFAULT 0,
  missing         integer NOT NULL DEFAULT 0,
  coverage_pct    numeric(5,2) NOT NULL DEFAULT 0,
  ugc_total       integer NOT NULL DEFAULT 0,
  ugc_translated  integer NOT NULL DEFAULT 0,
  ugc_coverage_pct numeric(5,2) NOT NULL DEFAULT 0,
  audited_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_i18n_coverage_locale ON public.i18n_coverage_audit(locale, audited_at DESC);

GRANT SELECT ON public.i18n_coverage_audit TO authenticated;
GRANT ALL ON public.i18n_coverage_audit TO service_role;
ALTER TABLE public.i18n_coverage_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "i18n_coverage admin read" ON public.i18n_coverage_audit FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- ---------------------------------------------------------------------
-- 7. i18n_banned_terms — per-locale denylist
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.i18n_banned_terms (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  locale      text NOT NULL,
  term        text NOT NULL,
  category    text NOT NULL DEFAULT 'profanity',
  whole_word  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (locale, term)
);
CREATE INDEX IF NOT EXISTS idx_i18n_banned_locale ON public.i18n_banned_terms(locale);

GRANT SELECT ON public.i18n_banned_terms TO authenticated;
GRANT ALL ON public.i18n_banned_terms TO service_role;
ALTER TABLE public.i18n_banned_terms ENABLE ROW LEVEL SECURITY;
CREATE POLICY "i18n_banned admin manage" ON public.i18n_banned_terms FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- ---------------------------------------------------------------------
-- 8. i18n_content_registry — declares translatable UGC columns
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.i18n_content_registry (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name      text NOT NULL,
  column_name     text NOT NULL,
  content_format  text NOT NULL DEFAULT 'plain' CHECK (content_format IN ('plain','markdown','html','rich_text')),
  priority        text NOT NULL DEFAULT 'warm' CHECK (priority IN ('hot','warm','cold')),
  max_chars       integer DEFAULT 20000,
  is_pii          boolean NOT NULL DEFAULT false,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (table_name, column_name)
);

GRANT SELECT ON public.i18n_content_registry TO authenticated;
GRANT ALL ON public.i18n_content_registry TO service_role;
ALTER TABLE public.i18n_content_registry ENABLE ROW LEVEL SECURITY;
CREATE POLICY "i18n_content_registry read" ON public.i18n_content_registry FOR SELECT TO authenticated USING (true);
CREATE POLICY "i18n_content_registry admin manage" ON public.i18n_content_registry FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Seed registry with common translatable columns. Skips silently if table/column missing.
INSERT INTO public.i18n_content_registry (table_name, column_name, content_format, priority) VALUES
  ('clients','description','markdown','warm'),
  ('projects','title','plain','hot'),
  ('projects','description','markdown','hot'),
  ('projects','brief','markdown','hot'),
  ('applications','essay_response','plain','warm'),
  ('announcements','title','plain','hot'),
  ('announcements','body','html','hot'),
  ('courses','title','plain','hot'),
  ('courses','description','markdown','hot'),
  ('lessons','title','plain','hot'),
  ('lessons','body','html','warm'),
  ('profiles','bio','plain','cold')
ON CONFLICT (table_name, column_name) DO NOTHING;

-- ---------------------------------------------------------------------
-- 9. ugc_translations — translation cache for user-generated content
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ugc_translations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_table    text NOT NULL,
  entity_id       uuid NOT NULL,
  column_name     text NOT NULL,
  source_locale   text NOT NULL DEFAULT 'en',
  target_locale   text NOT NULL,
  source_hash     text NOT NULL,
  translated_text text,
  content_format  text NOT NULL DEFAULT 'plain',
  status          text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','qa_passed','qa_failed','flagged','approved')),
  qa_report       jsonb,
  is_admin_edited boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity_table, entity_id, column_name, target_locale, source_hash)
);
CREATE INDEX IF NOT EXISTS idx_ugc_translations_entity_lookup
  ON public.ugc_translations(entity_table, entity_id, target_locale);
CREATE INDEX IF NOT EXISTS idx_ugc_translations_status
  ON public.ugc_translations(status) WHERE status IN ('pending','qa_failed','flagged');
CREATE INDEX IF NOT EXISTS idx_ugc_translations_updated
  ON public.ugc_translations(updated_at DESC);

GRANT SELECT ON public.ugc_translations TO anon, authenticated;
GRANT ALL ON public.ugc_translations TO service_role;
ALTER TABLE public.ugc_translations ENABLE ROW LEVEL SECURITY;
-- Read is public (translations expose no more info than the source row already does).
CREATE POLICY "ugc_translations public read passed" ON public.ugc_translations FOR SELECT
  USING (status IN ('qa_passed','approved'));
CREATE POLICY "ugc_translations admin all" ON public.ugc_translations FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- ---------------------------------------------------------------------
-- 10. ugc_translation_jobs — async queue for UGC translations
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ugc_translation_jobs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_table    text NOT NULL,
  entity_id       uuid NOT NULL,
  column_name     text NOT NULL,
  target_locale   text NOT NULL,
  source_hash     text NOT NULL,
  source_text     text NOT NULL,
  content_format  text NOT NULL DEFAULT 'plain',
  priority        text NOT NULL DEFAULT 'batch'
    CHECK (priority IN ('realtime','batch','backfill')),
  status          text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','done','failed')),
  attempts        integer NOT NULL DEFAULT 0,
  last_error      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ugc_jobs_pending
  ON public.ugc_translation_jobs(priority, created_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_ugc_jobs_dedupe
  ON public.ugc_translation_jobs(entity_table, entity_id, column_name, target_locale, source_hash);

GRANT SELECT ON public.ugc_translation_jobs TO authenticated;
GRANT ALL ON public.ugc_translation_jobs TO service_role;
ALTER TABLE public.ugc_translation_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ugc_jobs admin read" ON public.ugc_translation_jobs FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- ---------------------------------------------------------------------
-- 11. Helper: active locales (locales used in last 7 days)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_active_locales()
RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(
    array_agg(DISTINCT preferred_language)
      FILTER (WHERE preferred_language IS NOT NULL AND preferred_language <> 'en'),
    ARRAY[]::text[]
  )
  FROM public.profiles
  WHERE updated_at > now() - interval '7 days';
$$;
GRANT EXECUTE ON FUNCTION public.get_active_locales() TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 12. Generic UGC translation trigger
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enqueue_ugc_translation_jobs()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_reg     record;
  v_text    text;
  v_hash    text;
  v_locale  text;
  v_locales text[];
BEGIN
  -- Process every registered column for this table
  FOR v_reg IN
    SELECT column_name, content_format, max_chars, is_pii, priority
    FROM public.i18n_content_registry
    WHERE table_name = TG_TABLE_NAME AND is_active = true
  LOOP
    IF v_reg.is_pii THEN CONTINUE; END IF;

    EXECUTE format('SELECT ($1).%I::text', v_reg.column_name) INTO v_text USING NEW;
    IF v_text IS NULL OR length(btrim(v_text)) = 0 THEN CONTINUE; END IF;
    IF v_reg.max_chars IS NOT NULL AND length(v_text) > v_reg.max_chars THEN CONTINUE; END IF;

    v_hash := encode(digest(v_text, 'sha256'), 'hex');

    -- Skip if source unchanged on UPDATE
    IF TG_OP = 'UPDATE' THEN
      DECLARE v_old text; BEGIN
        EXECUTE format('SELECT ($1).%I::text', v_reg.column_name) INTO v_old USING OLD;
        IF v_old IS NOT DISTINCT FROM v_text THEN CONTINUE; END IF;
      END;
    END IF;

    v_locales := public.get_active_locales();
    IF v_locales IS NULL OR cardinality(v_locales) = 0 THEN CONTINUE; END IF;

    FOREACH v_locale IN ARRAY v_locales
    LOOP
      INSERT INTO public.ugc_translation_jobs
        (entity_table, entity_id, column_name, target_locale, source_hash, source_text, content_format, priority)
      VALUES
        (TG_TABLE_NAME, NEW.id, v_reg.column_name, v_locale, v_hash, v_text, v_reg.content_format,
         CASE WHEN v_reg.priority = 'hot' THEN 'realtime' ELSE 'batch' END)
      ON CONFLICT DO NOTHING;
    END LOOP;
  END LOOP;
  RETURN NEW;
END;
$$;

-- Attach trigger to known UGC tables (skip silently if table doesn't exist)
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT DISTINCT table_name FROM public.i18n_content_registry WHERE is_active = true
  LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = t) THEN
      EXECUTE format('DROP TRIGGER IF EXISTS trg_enqueue_ugc_translations ON public.%I', t);
      EXECUTE format(
        'CREATE TRIGGER trg_enqueue_ugc_translations AFTER INSERT OR UPDATE ON public.%I
         FOR EACH ROW EXECUTE FUNCTION public.enqueue_ugc_translation_jobs()', t);
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 13. Pin extension pgcrypto (digest)
-- ---------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
