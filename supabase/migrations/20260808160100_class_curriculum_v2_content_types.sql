-- ============================================================================
-- Class Curriculum v2 — Slice 2: file & link content types (F4)
--
-- Adds a single attachments table (files + links share it for uniform ordering
-- and rendering), a PRIVATE storage bucket for lesson files, and editor-gated
-- RPCs to create/remove attachments. Additive / expand-phase only.
--
-- Security posture (owasp-secure-coding-bdd — file upload + injection + IDOR):
--   * Files live in a PRIVATE bucket (public=false); learners get bytes only via
--     short-lived signed URLs, never public links.
--   * register_class_module_file enforces a server-side MIME ALLOWLIST, a size
--     ceiling (100 MB), and an IDOR guard that the storage path is scoped to the
--     exact class+item the caller is editing (client cannot register an object
--     it doesn't own into someone else's item).
--   * links are validated as absolute http(s) URLs server-side (rejects
--     javascript:/data:/relative), stored NEVER fetched (no SSRF surface).
--   * All writes go through SECURITY DEFINER RPCs; no INSERT/UPDATE/DELETE
--     policy is granted to `authenticated` (matches the repo convention).
--
-- Release gating of learner reads/downloads is added in Slice 3 (this migration
-- gates on published + entitled; Slice 3 CREATE-OR-REPLACEs the two helpers to
-- also require the item be released). The slices ship in one PR, so the end
-- state always has the release gate.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Enum
-- ----------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.class_module_attachment_kind AS ENUM ('file','link');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ----------------------------------------------------------------------------
-- 1. Attachments table
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.class_module_attachments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id      uuid NOT NULL REFERENCES public.class_module_items(id) ON DELETE CASCADE,
  class_id     uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  kind         public.class_module_attachment_kind NOT NULL,
  position     integer NOT NULL,
  -- link fields
  url          text CHECK (url IS NULL OR char_length(url) <= 2048),
  label        text CHECK (label IS NULL OR char_length(label) <= 200),
  -- file fields (object lives in the private bucket; store the path, never a public URL)
  storage_path text CHECK (storage_path IS NULL OR char_length(storage_path) <= 1024),
  file_name    text CHECK (file_name IS NULL OR char_length(file_name) <= 255),
  mime_type    text CHECK (mime_type IS NULL OR char_length(mime_type) <= 255),
  size_bytes   bigint CHECK (size_bytes IS NULL OR size_bytes BETWEEN 0 AND 104857600), -- 100 MB
  created_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  -- Exactly one shape per row: a link carries a url and no storage_path; a file
  -- carries a storage_path and no url.
  CONSTRAINT class_module_attachments_shape CHECK (
      (kind = 'link' AND url IS NOT NULL AND storage_path IS NULL)
   OR (kind = 'file' AND storage_path IS NOT NULL AND url IS NULL)
  )
);

-- Deferrable unique lets attachment reorders swap positions atomically in one tx
-- (same pattern the sections/items tables use).
DO $$ BEGIN
  ALTER TABLE public.class_module_attachments
    ADD CONSTRAINT class_module_attachments_item_position_key
    UNIQUE (item_id, position) DEFERRABLE INITIALLY DEFERRED;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_class_module_attachments_item
  ON public.class_module_attachments(item_id, position);
CREATE INDEX IF NOT EXISTS idx_class_module_attachments_class
  ON public.class_module_attachments(class_id);

GRANT SELECT ON public.class_module_attachments TO authenticated;
GRANT ALL ON public.class_module_attachments TO service_role;
ALTER TABLE public.class_module_attachments ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS trg_class_module_attachments_updated_at ON public.class_module_attachments;
CREATE TRIGGER trg_class_module_attachments_updated_at
  BEFORE UPDATE ON public.class_module_attachments
  FOR EACH ROW EXECUTE FUNCTION public._tf_touch_updated_at();

-- ----------------------------------------------------------------------------
-- 2. RLS: editors see all; entitled learners see attachments of a PUBLISHED item.
--    (Slice 3 tightens the learner branch to also require the item be released.)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "cma_select" ON public.class_module_attachments;
CREATE POLICY "cma_select" ON public.class_module_attachments
  FOR SELECT TO authenticated
  USING (
    public.is_class_owner(class_id, auth.uid())
    OR public.has_role(auth.uid(), 'admin')
    OR (
      public.is_class_learner(class_id, auth.uid())
      AND EXISTS (
        SELECT 1 FROM public.class_module_items i
        WHERE i.id = item_id AND i.status = 'published'
      )
    )
  );
-- Writes are RPC-only; intentionally no INSERT/UPDATE/DELETE policy for authenticated.

-- ----------------------------------------------------------------------------
-- 3. Link RPC — validated absolute http(s) URL, stored not fetched (SSRF-safe).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.upsert_class_module_link(
  p_item_id uuid,
  p_attachment_id uuid,
  p_url text,
  p_label text
) RETURNS public.class_module_attachments
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_class uuid;
  v_row public.class_module_attachments%ROWTYPE;
  v_pos integer;
  v_actor uuid := auth.uid();
BEGIN
  SELECT class_id INTO v_class FROM public.class_module_items WHERE id = p_item_id;
  IF v_class IS NULL THEN RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002'; END IF;
  PERFORM public._assert_class_editor(v_class);

  -- Absolute http(s) only. Anchored scheme rejects javascript:/data:/vbscript:
  -- and relative URLs; the '.' requirement rejects bare hosts like "http://x".
  IF p_url IS NULL OR char_length(p_url) > 2048
     OR btrim(p_url) !~* '^https?://[^[:space:]]+\.[^[:space:]]+' THEN
    RAISE EXCEPTION 'invalid_url' USING ERRCODE = '22023';
  END IF;

  IF p_attachment_id IS NULL THEN
    -- Bound attachments per item (business-logic DoS).
    IF (SELECT count(*) FROM public.class_module_attachments WHERE item_id = p_item_id) >= 100 THEN
      RAISE EXCEPTION 'too_many_attachments' USING ERRCODE = '22023';
    END IF;
    SELECT COALESCE(MAX(position), 0) + 1 INTO v_pos
      FROM public.class_module_attachments WHERE item_id = p_item_id;
    INSERT INTO public.class_module_attachments(item_id, class_id, kind, position, url, label, created_by)
    VALUES (p_item_id, v_class, 'link', v_pos, btrim(p_url),
            NULLIF(btrim(COALESCE(p_label, '')), ''), v_actor)
    RETURNING * INTO v_row;
  ELSE
    UPDATE public.class_module_attachments
       SET url = btrim(p_url), label = NULLIF(btrim(COALESCE(p_label, '')), '')
     WHERE id = p_attachment_id AND item_id = p_item_id AND kind = 'link'
    RETURNING * INTO v_row;
    IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  END IF;

  INSERT INTO public.class_module_audit(class_id, actor_user_id, entity_type, entity_id, action, diff)
  VALUES (v_class, v_actor, 'item', p_item_id, 'attach_link',
          jsonb_build_object('url', left(v_row.url, 120)));
  RETURN v_row;
END $$;
REVOKE ALL ON FUNCTION public.upsert_class_module_link(uuid, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_class_module_link(uuid, uuid, text, text) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4. File register RPC — the client uploads to the private bucket first, then
--    calls this to record the row. MIME allowlist + size ceiling + path-IDOR
--    guard are all enforced here, server-side.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.register_class_module_file(
  p_item_id uuid,
  p_storage_path text,
  p_file_name text,
  p_mime_type text,
  p_size_bytes bigint
) RETURNS public.class_module_attachments
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_class uuid;
  v_row public.class_module_attachments%ROWTYPE;
  v_pos integer;
  v_actor uuid := auth.uid();
  v_allowed text[] := ARRAY[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',   -- .docx
    'application/vnd.openxmlformats-officedocument.presentationml.presentation', -- .pptx
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',         -- .xlsx
    'image/png', 'image/jpeg', 'image/gif', 'image/webp',
    'application/zip'
    -- SVG intentionally excluded: it is an XSS vector when served inline.
  ];
BEGIN
  SELECT class_id INTO v_class FROM public.class_module_items WHERE id = p_item_id;
  IF v_class IS NULL THEN RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002'; END IF;
  PERFORM public._assert_class_editor(v_class);

  -- IDOR guard: the path MUST be scoped to this class + item. A teacher cannot
  -- register an object living under another class/item into this row.
  IF p_storage_path IS NULL
     OR p_storage_path !~ ('^class/' || v_class::text || '/item/' || p_item_id::text || '/') THEN
    RAISE EXCEPTION 'invalid_path' USING ERRCODE = '22023';
  END IF;
  -- Reject traversal / unsafe characters in the key (defence in depth beyond the
  -- anchored prefix): the whole path must be safe-charset and contain no "..".
  IF p_storage_path ~ '\.\.' OR p_storage_path !~ '^[A-Za-z0-9/_.\-]+$' THEN
    RAISE EXCEPTION 'invalid_path' USING ERRCODE = '22023';
  END IF;

  -- Bound attachments per item (business-logic DoS / storage exhaustion).
  IF (SELECT count(*) FROM public.class_module_attachments WHERE item_id = p_item_id) >= 100 THEN
    RAISE EXCEPTION 'too_many_attachments' USING ERRCODE = '22023';
  END IF;
  IF p_mime_type IS NULL OR NOT (p_mime_type = ANY(v_allowed)) THEN
    RAISE EXCEPTION 'unsupported_mime' USING ERRCODE = '22023';
  END IF;
  IF p_size_bytes IS NULL OR p_size_bytes < 0 OR p_size_bytes > 104857600 THEN
    RAISE EXCEPTION 'file_too_large' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(MAX(position), 0) + 1 INTO v_pos
    FROM public.class_module_attachments WHERE item_id = p_item_id;
  INSERT INTO public.class_module_attachments(
    item_id, class_id, kind, position, storage_path, file_name, mime_type, size_bytes, created_by)
  VALUES (
    p_item_id, v_class, 'file', v_pos, p_storage_path,
    -- Strip path separators / control chars from the display name (defence in depth).
    left(regexp_replace(COALESCE(p_file_name, 'file'), '[\\/\r\n\t]', '_', 'g'), 255),
    p_mime_type, p_size_bytes, v_actor)
  RETURNING * INTO v_row;

  INSERT INTO public.class_module_audit(class_id, actor_user_id, entity_type, entity_id, action, diff)
  VALUES (v_class, v_actor, 'item', p_item_id, 'attach_file',
          jsonb_build_object('file_name', v_row.file_name, 'size', v_row.size_bytes));
  RETURN v_row;
END $$;
REVOKE ALL ON FUNCTION public.register_class_module_file(uuid, text, text, text, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_class_module_file(uuid, text, text, text, bigint) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 5. Delete RPC — removes the row (authoritative) and returns the storage path
--    so the client can delete the object too. Editor-gated + audited.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_class_module_attachment(p_attachment_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_class uuid;
  v_path text;
  v_item uuid;
  v_actor uuid := auth.uid();
BEGIN
  SELECT class_id, storage_path, item_id INTO v_class, v_path, v_item
    FROM public.class_module_attachments WHERE id = p_attachment_id;
  IF v_class IS NULL THEN RETURN NULL; END IF;
  PERFORM public._assert_class_editor(v_class);

  DELETE FROM public.class_module_attachments WHERE id = p_attachment_id;

  INSERT INTO public.class_module_audit(class_id, actor_user_id, entity_type, entity_id, action)
  VALUES (v_class, v_actor, 'item', v_item, 'detach');
  RETURN v_path;  -- non-null for files; client removes the object from storage
END $$;
REVOKE ALL ON FUNCTION public.delete_class_module_attachment(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_class_module_attachment(uuid) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 6. Private storage bucket + RLS. Video is NEVER stored here (embed only) —
--    files only, so egress stays bounded (see storage-architecture analysis).
-- ----------------------------------------------------------------------------
-- Enforce size + MIME at the STORAGE edge too, so an oversized or disallowed
-- object is rejected before it lands (not merely at register-time). ON CONFLICT
-- DO UPDATE keeps these limits applied even if the bucket already exists.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'class-module-files', 'class-module-files', false,
  104857600,  -- 100 MB
  ARRAY[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'image/png', 'image/jpeg', 'image/gif', 'image/webp',
    'application/zip'
  ]
)
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Read gate. Path shape: class/{class_id}/item/{item_id}/{uuid}-{filename}.
-- Slice 3 CREATE-OR-REPLACEs this to also require the item be released.
CREATE OR REPLACE FUNCTION public.can_read_class_module_file(_name text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_class uuid; v_item uuid; parts text[];
BEGIN
  parts := string_to_array(_name, '/');
  IF array_length(parts, 1) < 5 OR parts[1] <> 'class' OR parts[3] <> 'item' THEN
    RETURN false;
  END IF;
  BEGIN
    v_class := parts[2]::uuid; v_item := parts[4]::uuid;
  EXCEPTION WHEN others THEN RETURN false; END;

  IF public.is_class_owner(v_class, auth.uid()) OR public.has_role(auth.uid(), 'admin') THEN
    RETURN true;
  END IF;
  RETURN public.is_class_learner(v_class, auth.uid())
     AND EXISTS (SELECT 1 FROM public.class_module_items i
                 WHERE i.id = v_item AND i.status = 'published');
END $$;
REVOKE ALL ON FUNCTION public.can_read_class_module_file(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_read_class_module_file(text) TO authenticated, service_role;

-- Write gate: admin, or a CURRENT teacher who owns the class encoded in the path.
CREATE OR REPLACE FUNCTION public.can_write_class_module_file(_name text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_class uuid; parts text[];
BEGIN
  parts := string_to_array(_name, '/');
  IF array_length(parts, 1) < 5 OR parts[1] <> 'class' THEN RETURN false; END IF;
  BEGIN v_class := parts[2]::uuid; EXCEPTION WHEN others THEN RETURN false; END;
  RETURN public.has_role(auth.uid(), 'admin')
     OR (public.is_class_owner(v_class, auth.uid()) AND public.has_role(auth.uid(), 'teacher'));
END $$;
REVOKE ALL ON FUNCTION public.can_write_class_module_file(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_write_class_module_file(text) TO authenticated, service_role;

DROP POLICY IF EXISTS "cmf_select" ON storage.objects;
CREATE POLICY "cmf_select" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'class-module-files' AND public.can_read_class_module_file(name));

DROP POLICY IF EXISTS "cmf_insert" ON storage.objects;
CREATE POLICY "cmf_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'class-module-files' AND public.can_write_class_module_file(name));

DROP POLICY IF EXISTS "cmf_update" ON storage.objects;
CREATE POLICY "cmf_update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'class-module-files' AND public.can_write_class_module_file(name));

DROP POLICY IF EXISTS "cmf_delete" ON storage.objects;
CREATE POLICY "cmf_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'class-module-files' AND public.can_write_class_module_file(name));
