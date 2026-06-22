
-- ============================================================================
-- Class Curriculum: teacher-authored sections + modules at the class level
-- ============================================================================

-- Enums ----------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.class_module_status AS ENUM ('draft','published','archived');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.class_module_video_provider AS ENUM ('youtube','vimeo','loom','google_meet','other','none');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.class_module_action_type AS ENUM ('read','watch','task');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================================
-- Sections
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.class_module_sections (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id     uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  title        text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  summary      text CHECK (summary IS NULL OR char_length(summary) <= 500),
  position     integer NOT NULL,
  status       public.class_module_status NOT NULL DEFAULT 'draft',
  created_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  published_at timestamptz,
  archived_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Deferrable unique allows atomic position swaps inside one transaction.
ALTER TABLE public.class_module_sections
  DROP CONSTRAINT IF EXISTS class_module_sections_class_position_key;
ALTER TABLE public.class_module_sections
  ADD CONSTRAINT class_module_sections_class_position_key
  UNIQUE (class_id, position) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX IF NOT EXISTS idx_class_module_sections_class
  ON public.class_module_sections(class_id, position);

GRANT SELECT ON public.class_module_sections TO authenticated;
GRANT ALL ON public.class_module_sections TO service_role;
ALTER TABLE public.class_module_sections ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- Items (modules within a section)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.class_module_items (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section_id         uuid NOT NULL REFERENCES public.class_module_sections(id) ON DELETE CASCADE,
  class_id           uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  title              text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  position           integer NOT NULL,
  content_html       text CHECK (content_html IS NULL OR octet_length(content_html) <= 204800),
  video_url          text CHECK (video_url IS NULL OR char_length(video_url) <= 2048),
  video_provider     public.class_module_video_provider NOT NULL DEFAULT 'none',
  video_embed_url    text,
  action_type        public.class_module_action_type NOT NULL DEFAULT 'read',
  duration_minutes   integer CHECK (duration_minutes IS NULL OR duration_minutes BETWEEN 0 AND 100000),
  required           boolean NOT NULL DEFAULT true,
  status             public.class_module_status NOT NULL DEFAULT 'draft',
  created_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  published_at       timestamptz,
  archived_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.class_module_items
  DROP CONSTRAINT IF EXISTS class_module_items_section_position_key;
ALTER TABLE public.class_module_items
  ADD CONSTRAINT class_module_items_section_position_key
  UNIQUE (section_id, position) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX IF NOT EXISTS idx_class_module_items_section ON public.class_module_items(section_id, position);
CREATE INDEX IF NOT EXISTS idx_class_module_items_class ON public.class_module_items(class_id);

GRANT SELECT ON public.class_module_items TO authenticated;
GRANT ALL ON public.class_module_items TO service_role;
ALTER TABLE public.class_module_items ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- Progress
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.class_module_progress (
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  item_id      uuid NOT NULL REFERENCES public.class_module_items(id) ON DELETE CASCADE,
  class_id     uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  completed    boolean NOT NULL DEFAULT false,
  completed_at timestamptz,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, item_id)
);
CREATE INDEX IF NOT EXISTS idx_class_module_progress_user_class
  ON public.class_module_progress(user_id, class_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.class_module_progress TO authenticated;
GRANT ALL ON public.class_module_progress TO service_role;
ALTER TABLE public.class_module_progress ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- Audit (append-only)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.class_module_audit (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id      uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  entity_type   text NOT NULL CHECK (entity_type IN ('section','item','reorder','publish')),
  entity_id     uuid,
  action        text NOT NULL CHECK (char_length(action) <= 64),
  diff          jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_class_module_audit_class ON public.class_module_audit(class_id, created_at DESC);

GRANT SELECT ON public.class_module_audit TO authenticated;
GRANT ALL ON public.class_module_audit TO service_role;
ALTER TABLE public.class_module_audit ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE ON public.class_module_audit FROM authenticated;

-- ============================================================================
-- Helpers
-- ============================================================================

-- updated_at trigger reuse
CREATE OR REPLACE FUNCTION public._tf_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_class_module_sections_updated_at ON public.class_module_sections;
CREATE TRIGGER trg_class_module_sections_updated_at
  BEFORE UPDATE ON public.class_module_sections
  FOR EACH ROW EXECUTE FUNCTION public._tf_touch_updated_at();

DROP TRIGGER IF EXISTS trg_class_module_items_updated_at ON public.class_module_items;
CREATE TRIGGER trg_class_module_items_updated_at
  BEFORE UPDATE ON public.class_module_items
  FOR EACH ROW EXECUTE FUNCTION public._tf_touch_updated_at();

DROP TRIGGER IF EXISTS trg_class_module_progress_updated_at ON public.class_module_progress;
CREATE TRIGGER trg_class_module_progress_updated_at
  BEFORE UPDATE ON public.class_module_progress
  FOR EACH ROW EXECUTE FUNCTION public._tf_touch_updated_at();

-- Owner / admin helpers ------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_class_owner(_class_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.classes c WHERE c.id = _class_id AND c.owner_user_id = _user_id
  );
$$;
REVOKE ALL ON FUNCTION public.is_class_owner(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_class_owner(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.is_enrolled_in_class(_class_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.cohort_registrations r
    JOIN public.cohorts co ON co.id = r.cohort_id
    WHERE co.class_id = _class_id AND r.user_id = _user_id
  );
$$;
REVOKE ALL ON FUNCTION public.is_enrolled_in_class(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_enrolled_in_class(uuid, uuid) TO authenticated, service_role;

-- ============================================================================
-- HTML sanitizer (strict allowlist, regex-based defence-in-depth)
-- Client also runs DOMPurify; this is the server-side floor.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.sanitize_class_module_html(_html text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
  s text := COALESCE(_html, '');
BEGIN
  IF s = '' THEN RETURN ''; END IF;
  -- Strip dangerous tag pairs (case-insensitive, including their contents).
  s := regexp_replace(s, '<\s*(script|style|iframe|object|embed|link|meta|form|input|button|svg|math)\b[^>]*>.*?<\s*/\s*\1\s*>', '', 'gis');
  -- Strip self-closing variants of the same tags.
  s := regexp_replace(s, '<\s*(script|style|iframe|object|embed|link|meta|form|input|button|svg|math)\b[^>]*/?>', '', 'gi');
  -- Strip inline event handlers: on*="..." or on*='...'.
  s := regexp_replace(s, '\son[a-z]+\s*=\s*"[^"]*"', '', 'gi');
  s := regexp_replace(s, E'\\son[a-z]+\\s*=\\s*''[^'']*''', '', 'gi');
  s := regexp_replace(s, '\son[a-z]+\s*=\s*[^\s>]+', '', 'gi');
  -- Neuter javascript:, data:, vbscript: URIs in href/src.
  s := regexp_replace(s, '(href|src|xlink:href)\s*=\s*"(\s*(javascript|data|vbscript):[^"]*)"', '\1="#"', 'gi');
  s := regexp_replace(s, E'(href|src|xlink:href)\\s*=\\s*''(\\s*(javascript|data|vbscript):[^'']*)''', '\1=''#''', 'gi');
  -- Strip style attributes entirely (defence-in-depth against CSS exfil).
  s := regexp_replace(s, '\sstyle\s*=\s*"[^"]*"', '', 'gi');
  s := regexp_replace(s, E'\\sstyle\\s*=\\s*''[^'']*''', '', 'gi');
  RETURN s;
END $$;
REVOKE ALL ON FUNCTION public.sanitize_class_module_html(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sanitize_class_module_html(text) TO authenticated, service_role;

-- ============================================================================
-- Video URL normalizer
-- ============================================================================
CREATE OR REPLACE FUNCTION public.derive_class_module_video(
  _url text,
  OUT provider public.class_module_video_provider,
  OUT embed_url text
) LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
  u text := COALESCE(trim(_url), '');
  m text[];
BEGIN
  provider := 'none'; embed_url := NULL;
  IF u = '' THEN RETURN; END IF;
  -- Reject non-https / non-http
  IF u !~* '^https?://' THEN
    provider := 'other'; embed_url := NULL; RETURN;
  END IF;

  -- YouTube
  m := regexp_match(u, '(?:youtube\.com/(?:watch\?v=|embed/|shorts/)|youtu\.be/)([A-Za-z0-9_-]{6,20})', 'i');
  IF m IS NOT NULL THEN
    provider := 'youtube';
    embed_url := 'https://www.youtube-nocookie.com/embed/' || m[1];
    RETURN;
  END IF;

  -- Vimeo
  m := regexp_match(u, 'vimeo\.com/(?:video/)?([0-9]+)', 'i');
  IF m IS NOT NULL THEN
    provider := 'vimeo'; embed_url := 'https://player.vimeo.com/video/' || m[1]; RETURN;
  END IF;

  -- Loom
  m := regexp_match(u, 'loom\.com/(?:share|embed)/([A-Za-z0-9]+)', 'i');
  IF m IS NOT NULL THEN
    provider := 'loom'; embed_url := 'https://www.loom.com/embed/' || m[1]; RETURN;
  END IF;

  -- Google Meet (cannot iframe — store the URL, UI renders a join CTA)
  IF u ~* '^https://meet\.google\.com/' THEN
    provider := 'google_meet'; embed_url := u; RETURN;
  END IF;

  provider := 'other'; embed_url := NULL;
END $$;
REVOKE ALL ON FUNCTION public.derive_class_module_video(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.derive_class_module_video(text) TO authenticated, service_role;

-- ============================================================================
-- RLS POLICIES
-- ============================================================================

-- Sections: SELECT
DROP POLICY IF EXISTS "cms_sections_select" ON public.class_module_sections;
CREATE POLICY "cms_sections_select" ON public.class_module_sections
  FOR SELECT TO authenticated
  USING (
    public.is_class_owner(class_id, auth.uid())
    OR public.has_role(auth.uid(), 'admin')
    OR (status = 'published' AND public.is_enrolled_in_class(class_id, auth.uid()))
  );

-- Items: SELECT
DROP POLICY IF EXISTS "cms_items_select" ON public.class_module_items;
CREATE POLICY "cms_items_select" ON public.class_module_items
  FOR SELECT TO authenticated
  USING (
    public.is_class_owner(class_id, auth.uid())
    OR public.has_role(auth.uid(), 'admin')
    OR (status = 'published' AND public.is_enrolled_in_class(class_id, auth.uid()))
  );

-- Progress: own row only
DROP POLICY IF EXISTS "cms_progress_select_own" ON public.class_module_progress;
CREATE POLICY "cms_progress_select_own" ON public.class_module_progress
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_class_owner(class_id, auth.uid())
    OR public.has_role(auth.uid(), 'admin')
  );

DROP POLICY IF EXISTS "cms_progress_write_own" ON public.class_module_progress;
CREATE POLICY "cms_progress_write_own" ON public.class_module_progress
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Audit: read for owner/admin
DROP POLICY IF EXISTS "cms_audit_select" ON public.class_module_audit;
CREATE POLICY "cms_audit_select" ON public.class_module_audit
  FOR SELECT TO authenticated
  USING (public.is_class_owner(class_id, auth.uid()) OR public.has_role(auth.uid(), 'admin'));

-- All writes to sections/items happen via SECURITY DEFINER RPCs; no INSERT/UPDATE/DELETE policies for authenticated.

-- ============================================================================
-- Write helpers (SECURITY DEFINER, owner-gated)
-- ============================================================================

CREATE OR REPLACE FUNCTION public._assert_class_editor(_class_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.is_class_owner(_class_id, auth.uid()) OR public.has_role(auth.uid(), 'admin')) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public._assert_class_editor(uuid) FROM PUBLIC;

-- ----------------------------------------------------------------------------
-- upsert_class_section
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.upsert_class_section(
  p_class_id uuid,
  p_section_id uuid,
  p_title text,
  p_summary text,
  p_status public.class_module_status
) RETURNS public.class_module_sections
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE
  v_row public.class_module_sections%ROWTYPE;
  v_next_pos integer;
  v_actor uuid := auth.uid();
BEGIN
  PERFORM public._assert_class_editor(p_class_id);
  IF p_title IS NULL OR length(btrim(p_title)) = 0 OR length(p_title) > 200 THEN
    RAISE EXCEPTION 'invalid_title' USING ERRCODE = '22023';
  END IF;

  IF p_section_id IS NULL THEN
    SELECT COALESCE(MAX(position), 0) + 1 INTO v_next_pos
      FROM public.class_module_sections WHERE class_id = p_class_id;
    INSERT INTO public.class_module_sections(class_id, title, summary, status, position, created_by, published_at)
    VALUES (
      p_class_id, btrim(p_title), NULLIF(btrim(COALESCE(p_summary,'')),''),
      COALESCE(p_status,'draft'), v_next_pos, v_actor,
      CASE WHEN p_status = 'published' THEN now() ELSE NULL END
    )
    RETURNING * INTO v_row;
    INSERT INTO public.class_module_audit(class_id, actor_user_id, entity_type, entity_id, action, diff)
    VALUES (p_class_id, v_actor, 'section', v_row.id, 'create', to_jsonb(v_row));
  ELSE
    UPDATE public.class_module_sections SET
      title = btrim(p_title),
      summary = NULLIF(btrim(COALESCE(p_summary,'')),''),
      status = COALESCE(p_status, status),
      published_at = CASE
        WHEN p_status = 'published' AND published_at IS NULL THEN now()
        WHEN p_status <> 'published' THEN NULL
        ELSE published_at END,
      archived_at = CASE WHEN p_status = 'archived' THEN now() ELSE NULL END
    WHERE id = p_section_id AND class_id = p_class_id
    RETURNING * INTO v_row;
    IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
    INSERT INTO public.class_module_audit(class_id, actor_user_id, entity_type, entity_id, action, diff)
    VALUES (p_class_id, v_actor, 'section', v_row.id, 'update', to_jsonb(v_row));
  END IF;
  RETURN v_row;
END $$;
REVOKE ALL ON FUNCTION public.upsert_class_section(uuid, uuid, text, text, public.class_module_status) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_class_section(uuid, uuid, text, text, public.class_module_status) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- delete_class_section
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_class_section(p_section_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_class uuid; v_actor uuid := auth.uid();
BEGIN
  SELECT class_id INTO v_class FROM public.class_module_sections WHERE id = p_section_id;
  IF v_class IS NULL THEN RETURN; END IF;
  PERFORM public._assert_class_editor(v_class);
  DELETE FROM public.class_module_sections WHERE id = p_section_id;
  INSERT INTO public.class_module_audit(class_id, actor_user_id, entity_type, entity_id, action)
  VALUES (v_class, v_actor, 'section', p_section_id, 'delete');
END $$;
REVOKE ALL ON FUNCTION public.delete_class_section(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_class_section(uuid) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- upsert_class_module_item
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.upsert_class_module_item(
  p_section_id uuid,
  p_item_id uuid,
  p_title text,
  p_content_html text,
  p_video_url text,
  p_action_type public.class_module_action_type,
  p_duration_minutes integer,
  p_required boolean,
  p_status public.class_module_status
) RETURNS public.class_module_items
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE
  v_row public.class_module_items%ROWTYPE;
  v_class uuid;
  v_next_pos integer;
  v_actor uuid := auth.uid();
  v_clean text;
  v_video record;
BEGIN
  SELECT class_id INTO v_class FROM public.class_module_sections WHERE id = p_section_id;
  IF v_class IS NULL THEN RAISE EXCEPTION 'section_not_found' USING ERRCODE = 'P0002'; END IF;
  PERFORM public._assert_class_editor(v_class);

  IF p_title IS NULL OR length(btrim(p_title)) = 0 OR length(p_title) > 200 THEN
    RAISE EXCEPTION 'invalid_title' USING ERRCODE = '22023';
  END IF;

  v_clean := public.sanitize_class_module_html(p_content_html);
  SELECT * INTO v_video FROM public.derive_class_module_video(p_video_url);

  IF p_item_id IS NULL THEN
    SELECT COALESCE(MAX(position), 0) + 1 INTO v_next_pos
      FROM public.class_module_items WHERE section_id = p_section_id;
    INSERT INTO public.class_module_items(
      section_id, class_id, title, position, content_html,
      video_url, video_provider, video_embed_url,
      action_type, duration_minutes, required, status, created_by, published_at
    ) VALUES (
      p_section_id, v_class, btrim(p_title), v_next_pos, v_clean,
      NULLIF(btrim(COALESCE(p_video_url,'')),''), v_video.provider, v_video.embed_url,
      COALESCE(p_action_type,'read'), p_duration_minutes, COALESCE(p_required,true),
      COALESCE(p_status,'draft'), v_actor,
      CASE WHEN p_status = 'published' THEN now() ELSE NULL END
    )
    RETURNING * INTO v_row;
    INSERT INTO public.class_module_audit(class_id, actor_user_id, entity_type, entity_id, action, diff)
    VALUES (v_class, v_actor, 'item', v_row.id, 'create', to_jsonb(v_row));
  ELSE
    UPDATE public.class_module_items SET
      section_id = p_section_id,
      class_id = v_class,
      title = btrim(p_title),
      content_html = v_clean,
      video_url = NULLIF(btrim(COALESCE(p_video_url,'')),''),
      video_provider = v_video.provider,
      video_embed_url = v_video.embed_url,
      action_type = COALESCE(p_action_type, action_type),
      duration_minutes = p_duration_minutes,
      required = COALESCE(p_required, required),
      status = COALESCE(p_status, status),
      published_at = CASE
        WHEN p_status = 'published' AND published_at IS NULL THEN now()
        WHEN p_status <> 'published' THEN NULL
        ELSE published_at END,
      archived_at = CASE WHEN p_status = 'archived' THEN now() ELSE NULL END
    WHERE id = p_item_id
    RETURNING * INTO v_row;
    IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
    INSERT INTO public.class_module_audit(class_id, actor_user_id, entity_type, entity_id, action, diff)
    VALUES (v_class, v_actor, 'item', v_row.id, 'update', to_jsonb(v_row));
  END IF;

  RETURN v_row;
END $$;
REVOKE ALL ON FUNCTION public.upsert_class_module_item(uuid, uuid, text, text, text, public.class_module_action_type, integer, boolean, public.class_module_status) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_class_module_item(uuid, uuid, text, text, text, public.class_module_action_type, integer, boolean, public.class_module_status) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- delete_class_module_item
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_class_module_item(p_item_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_class uuid; v_actor uuid := auth.uid();
BEGIN
  SELECT class_id INTO v_class FROM public.class_module_items WHERE id = p_item_id;
  IF v_class IS NULL THEN RETURN; END IF;
  PERFORM public._assert_class_editor(v_class);
  DELETE FROM public.class_module_items WHERE id = p_item_id;
  INSERT INTO public.class_module_audit(class_id, actor_user_id, entity_type, entity_id, action)
  VALUES (v_class, v_actor, 'item', p_item_id, 'delete');
END $$;
REVOKE ALL ON FUNCTION public.delete_class_module_item(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_class_module_item(uuid) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- reorder_class_sections
-- Atomic: push everything to negative space first, then renumber from 1.
-- Deferrable unique resolves at COMMIT.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reorder_class_sections(
  p_class_id uuid,
  p_ordered_ids uuid[]
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_count integer;
BEGIN
  PERFORM public._assert_class_editor(p_class_id);
  IF p_ordered_ids IS NULL OR cardinality(p_ordered_ids) = 0 THEN RETURN; END IF;

  -- Validate all ids belong to this class.
  SELECT count(*) INTO v_count FROM public.class_module_sections
   WHERE class_id = p_class_id AND id = ANY(p_ordered_ids);
  IF v_count <> cardinality(p_ordered_ids) THEN
    RAISE EXCEPTION 'reorder_mismatch' USING ERRCODE = '22023';
  END IF;

  -- Stage to negative range.
  UPDATE public.class_module_sections
     SET position = -position - 1
   WHERE class_id = p_class_id;

  -- Renumber by array order.
  UPDATE public.class_module_sections s
     SET position = ord.idx
    FROM unnest(p_ordered_ids) WITH ORDINALITY AS ord(id, idx)
   WHERE s.id = ord.id AND s.class_id = p_class_id;

  INSERT INTO public.class_module_audit(class_id, actor_user_id, entity_type, action, diff)
  VALUES (p_class_id, v_actor, 'reorder', 'sections', jsonb_build_object('order', to_jsonb(p_ordered_ids)));
END $$;
REVOKE ALL ON FUNCTION public.reorder_class_sections(uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reorder_class_sections(uuid, uuid[]) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- reorder_class_module_items (supports cross-section move)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reorder_class_module_items(
  p_section_id uuid,
  p_ordered_ids uuid[]
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_class uuid;
  v_actor uuid := auth.uid();
BEGIN
  SELECT class_id INTO v_class FROM public.class_module_sections WHERE id = p_section_id;
  IF v_class IS NULL THEN RAISE EXCEPTION 'section_not_found' USING ERRCODE = 'P0002'; END IF;
  PERFORM public._assert_class_editor(v_class);
  IF p_ordered_ids IS NULL OR cardinality(p_ordered_ids) = 0 THEN RETURN; END IF;

  -- Move items into this section + stage positions negative.
  UPDATE public.class_module_items
     SET position = -position - 1
   WHERE section_id = p_section_id;

  -- Reassign section_id + renumber. Items moved from another section come in here.
  UPDATE public.class_module_items i
     SET section_id = p_section_id,
         class_id = v_class,
         position = ord.idx
    FROM unnest(p_ordered_ids) WITH ORDINALITY AS ord(id, idx)
   WHERE i.id = ord.id;

  INSERT INTO public.class_module_audit(class_id, actor_user_id, entity_type, entity_id, action, diff)
  VALUES (v_class, v_actor, 'reorder', p_section_id, 'items', jsonb_build_object('order', to_jsonb(p_ordered_ids)));
END $$;
REVOKE ALL ON FUNCTION public.reorder_class_module_items(uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reorder_class_module_items(uuid, uuid[]) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- publish_class_curriculum (bulk publish drafts)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.publish_class_curriculum(p_class_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor uuid := auth.uid(); v_count integer := 0;
BEGIN
  PERFORM public._assert_class_editor(p_class_id);
  WITH s AS (
    UPDATE public.class_module_sections
       SET status='published', published_at=COALESCE(published_at, now())
     WHERE class_id = p_class_id AND status='draft' RETURNING 1
  ), i AS (
    UPDATE public.class_module_items
       SET status='published', published_at=COALESCE(published_at, now())
     WHERE class_id = p_class_id AND status='draft' RETURNING 1
  )
  SELECT (SELECT count(*) FROM s) + (SELECT count(*) FROM i) INTO v_count;
  INSERT INTO public.class_module_audit(class_id, actor_user_id, entity_type, action, diff)
  VALUES (p_class_id, v_actor, 'publish', 'bulk', jsonb_build_object('changed', v_count));
  RETURN v_count;
END $$;
REVOKE ALL ON FUNCTION public.publish_class_curriculum(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.publish_class_curriculum(uuid) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- toggle_class_module_completion (learner)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.toggle_class_module_completion(
  p_item_id uuid,
  p_completed boolean
) RETURNS public.class_module_progress
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE
  v_actor uuid := auth.uid();
  v_class uuid;
  v_status public.class_module_status;
  v_row public.class_module_progress%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'auth_required' USING ERRCODE='42501'; END IF;
  SELECT class_id, status INTO v_class, v_status FROM public.class_module_items WHERE id = p_item_id;
  IF v_class IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  IF v_status <> 'published' THEN RAISE EXCEPTION 'not_published' USING ERRCODE='42501'; END IF;
  IF NOT (public.is_enrolled_in_class(v_class, v_actor)
       OR public.is_class_owner(v_class, v_actor)
       OR public.has_role(v_actor, 'admin')) THEN
    RAISE EXCEPTION 'not_enrolled' USING ERRCODE='42501';
  END IF;

  INSERT INTO public.class_module_progress(user_id, item_id, class_id, completed, completed_at)
  VALUES (v_actor, p_item_id, v_class, COALESCE(p_completed,true),
          CASE WHEN COALESCE(p_completed,true) THEN now() ELSE NULL END)
  ON CONFLICT (user_id, item_id) DO UPDATE
    SET completed = EXCLUDED.completed,
        completed_at = CASE WHEN EXCLUDED.completed THEN now() ELSE NULL END
  RETURNING * INTO v_row;
  RETURN v_row;
END $$;
REVOKE ALL ON FUNCTION public.toggle_class_module_completion(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.toggle_class_module_completion(uuid, boolean) TO authenticated, service_role;
