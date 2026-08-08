-- ============================================================================
-- Class Curriculum v2 — Slice 3: per-class release engine (F1/F5/F10)
--
-- Adds the four release policies from the AC, enforced SERVER-SIDE so a learner
-- can never read locked content by calling PostgREST or a signed URL directly:
--   all_at_once | by_date | after_previous_completion | relative_to_cohort_start
--
-- The heart is:
--   * class_item_release(item, user) -> (released, available_at)  — single source
--     of truth for "may this user see this published item yet?"
--   * get_class_curriculum_for_learner(class) — the learner's ONLY read path:
--     resolves entitlement + release and OMITS bodies/attachments of locked
--     items (locked items leak title + availability only).
--
-- Additive / expand-phase. Every existing class defaults to release_policy
-- 'all_at_once', which is exactly today's behavior (published + entitled =
-- visible), so nothing changes for current data. The learner table-SELECT
-- policies are made release-aware here (§6) so a locked item is never readable
-- via raw PostgREST — no separate contract migration is required, and this is
-- backward-compatible for all existing (all_at_once) classes and the old client.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Enum + class-level policy columns (D2: one policy per class)
-- ----------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.class_release_policy AS ENUM
    ('all_at_once', 'by_date', 'after_previous_completion', 'relative_to_cohort_start');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.classes
  ADD COLUMN IF NOT EXISTS release_policy public.class_release_policy NOT NULL DEFAULT 'all_at_once',
  ADD COLUMN IF NOT EXISTS release_at timestamptz,
  ADD COLUMN IF NOT EXISTS release_offset_days integer;

DO $$ BEGIN
  ALTER TABLE public.classes
    ADD CONSTRAINT class_release_offset_range
    CHECK (release_offset_days IS NULL OR release_offset_days BETWEEN 0 AND 3650);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Integrity: a policy can never be saved without its required parameter
-- (AC "Data integrity: prevent broken states"). Existing rows all satisfy this
-- because they default to all_at_once with NULL params.
DO $$ BEGIN
  ALTER TABLE public.classes
    ADD CONSTRAINT class_release_policy_params_valid CHECK (
         (release_policy <> 'by_date' OR release_at IS NOT NULL)
     AND (release_policy <> 'relative_to_cohort_start' OR release_offset_days IS NOT NULL)
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ----------------------------------------------------------------------------
-- 1. Learner's own cohort start (F10): earliest cohort of THIS class the learner
--    is registered in. Cohort-relative release must use the learner's cohort,
--    not a single class value, so different cohorts unlock on different dates.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._learner_cohort_start(_class_id uuid, _user_id uuid)
RETURNS date LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT MIN(co.start_date)
  FROM public.cohort_registrations r
  JOIN public.cohorts co ON co.id = r.cohort_id
  WHERE co.class_id = _class_id AND r.user_id = _user_id;
$$;
REVOKE ALL ON FUNCTION public._learner_cohort_start(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._learner_cohort_start(uuid, uuid) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 2. Release engine — single source of truth. Answers "is this PUBLISHED item
--    released to this user, and when does it become available?" Callers handle
--    editor/admin bypass; this function is about the learner-facing rule only.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.class_item_release(
  _item_id uuid,
  _user_id uuid,
  OUT released boolean,
  OUT available_at timestamptz
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_class    uuid;
  v_policy   public.class_release_policy;
  v_rel_at   timestamptz;
  v_offset   integer;
  v_start    date;
  v_prev     uuid;
  v_prev_done boolean;
  v_sec_pos  integer;
  v_item_pos integer;
BEGIN
  released := false; available_at := NULL;

  -- Only PUBLISHED items in a PUBLISHED section are ever releasable.
  SELECT i.class_id, s.position, i.position
    INTO v_class, v_sec_pos, v_item_pos
  FROM public.class_module_items i
  JOIN public.class_module_sections s ON s.id = i.section_id
  WHERE i.id = _item_id AND i.status = 'published' AND s.status = 'published';
  IF v_class IS NULL THEN RETURN; END IF;

  SELECT release_policy, release_at, release_offset_days
    INTO v_policy, v_rel_at, v_offset
  FROM public.classes WHERE id = v_class;

  IF v_policy = 'all_at_once' THEN
    released := true; available_at := now(); RETURN;

  ELSIF v_policy = 'by_date' THEN
    available_at := v_rel_at;
    released := (v_rel_at IS NOT NULL AND now() >= v_rel_at); RETURN;

  ELSIF v_policy = 'relative_to_cohort_start' THEN
    v_start := public._learner_cohort_start(v_class, _user_id);
    IF v_start IS NULL OR v_offset IS NULL THEN RETURN; END IF;  -- no cohort => locked
    available_at := (v_start::timestamptz + make_interval(days => v_offset));
    released := (now() >= available_at); RETURN;

  ELSIF v_policy = 'after_previous_completion' THEN
    -- The previous PUBLISHED, REQUIRED item in global curriculum order.
    SELECT i.id INTO v_prev
    FROM public.class_module_items i
    JOIN public.class_module_sections s ON s.id = i.section_id
    WHERE i.class_id = v_class AND i.status = 'published' AND s.status = 'published'
      AND i.required = true
      AND (s.position, i.position) < (v_sec_pos, v_item_pos)
    ORDER BY s.position DESC, i.position DESC
    LIMIT 1;

    IF v_prev IS NULL THEN
      released := true; available_at := now(); RETURN;  -- first required item is open
    END IF;

    SELECT COALESCE(p.completed, false) INTO v_prev_done
    FROM public.class_module_progress p
    WHERE p.item_id = v_prev AND p.user_id = _user_id;
    released := COALESCE(v_prev_done, false);
    RETURN;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.class_item_release(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.class_item_release(uuid, uuid) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3. Release-policy setter (per-class, D2). Editor-gated; validates the param
--    server-side (belt-and-braces with the table CHECK) and clears the params
--    that don't apply to the chosen policy.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_class_release_policy(
  p_class_id uuid,
  p_policy public.class_release_policy,
  p_release_at timestamptz DEFAULT NULL,
  p_offset_days integer DEFAULT NULL
) RETURNS public.classes
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row public.classes%ROWTYPE; v_actor uuid := auth.uid();
BEGIN
  PERFORM public._assert_class_editor(p_class_id);

  IF p_policy = 'by_date' AND p_release_at IS NULL THEN
    RAISE EXCEPTION 'release_at_required' USING ERRCODE = '22023';
  END IF;
  IF p_policy = 'relative_to_cohort_start' AND p_offset_days IS NULL THEN
    RAISE EXCEPTION 'offset_required' USING ERRCODE = '22023';
  END IF;
  IF p_offset_days IS NOT NULL AND (p_offset_days < 0 OR p_offset_days > 3650) THEN
    RAISE EXCEPTION 'offset_out_of_range' USING ERRCODE = '22023';
  END IF;

  UPDATE public.classes SET
    release_policy = p_policy,
    release_at = CASE WHEN p_policy = 'by_date' THEN p_release_at ELSE NULL END,
    release_offset_days = CASE WHEN p_policy = 'relative_to_cohort_start' THEN p_offset_days ELSE NULL END
  WHERE id = p_class_id
  RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;

  INSERT INTO public.class_module_audit(class_id, actor_user_id, entity_type, entity_id, action, diff)
  VALUES (p_class_id, v_actor, 'publish', p_class_id, 'release_policy',
          jsonb_build_object('policy', p_policy, 'release_at', p_release_at, 'offset_days', p_offset_days));
  RETURN v_row;
END $$;
REVOKE ALL ON FUNCTION public.set_class_release_policy(uuid, public.class_release_policy, timestamptz, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_class_release_policy(uuid, public.class_release_policy, timestamptz, integer) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4. Completion release-guard (F5): a learner may only mark an item complete if
--    it is released to them — otherwise "after previous completion" could be
--    unlocked out of order by calling the RPC directly. Editors/admins (preview)
--    bypass the release check. Behavior is unchanged under all_at_once (every
--    published item is released), i.e. for every class that exists today.
--    Same signature as the live function — only the guard is added.
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
  v_is_editor boolean;
  v_rel record;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501'; END IF;
  SELECT class_id, status INTO v_class, v_status FROM public.class_module_items WHERE id = p_item_id;
  IF v_class IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_status <> 'published' THEN RAISE EXCEPTION 'not_published' USING ERRCODE = '42501'; END IF;

  v_is_editor := public.is_class_owner(v_class, v_actor) OR public.has_role(v_actor, 'admin');
  IF NOT (v_is_editor OR public.is_class_learner(v_class, v_actor)) THEN
    RAISE EXCEPTION 'not_enrolled' USING ERRCODE = '42501';
  END IF;

  -- Learners may only COMPLETE an item that is released to them (F5). Un-marking
  -- (p_completed = false) is always allowed. Editors bypass (preview).
  IF NOT v_is_editor AND COALESCE(p_completed, true) THEN
    SELECT * INTO v_rel FROM public.class_item_release(p_item_id, v_actor);
    IF NOT v_rel.released THEN RAISE EXCEPTION 'not_released' USING ERRCODE = '42501'; END IF;
  END IF;

  INSERT INTO public.class_module_progress(user_id, item_id, class_id, completed, completed_at)
  VALUES (v_actor, p_item_id, v_class, COALESCE(p_completed, true),
          CASE WHEN COALESCE(p_completed, true) THEN now() ELSE NULL END)
  ON CONFLICT (user_id, item_id) DO UPDATE
    SET completed = EXCLUDED.completed,
        completed_at = CASE WHEN EXCLUDED.completed THEN now() ELSE NULL END
  RETURNING * INTO v_row;
  RETURN v_row;
END $$;
REVOKE ALL ON FUNCTION public.toggle_class_module_completion(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.toggle_class_module_completion(uuid, boolean) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 5. Learner read RPC (F1): the learner's ONLY curriculum read path. Resolves
--    entitlement + release, returns published sections/items with a computed
--    `released` flag + `available_at`, and OMITS the body (content_html, video,
--    attachments) of any item that is not yet released. Editors/admins get
--    everything (all statuses, full bodies) for authoring/preview.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_class_curriculum_for_learner(p_class_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_is_editor boolean;
  v_out jsonb;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501'; END IF;
  v_is_editor := public.is_class_owner(p_class_id, v_actor) OR public.has_role(v_actor, 'admin');
  IF NOT (v_is_editor OR public.is_class_learner(p_class_id, v_actor)) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object('sections', COALESCE(jsonb_agg(sec ORDER BY sec_pos), '[]'::jsonb))
  INTO v_out
  FROM (
    SELECT s.position AS sec_pos,
      jsonb_build_object(
        'id', s.id, 'title', s.title, 'summary', s.summary, 'position', s.position,
        'items', COALESCE((
          SELECT jsonb_agg(item_json ORDER BY item_pos)
          FROM (
            SELECT i.position AS item_pos,
              jsonb_build_object(
                'id', i.id, 'title', i.title, 'position', i.position,
                'action_type', i.action_type, 'required', i.required,
                'duration_minutes', i.duration_minutes,
                'released', (rel.released OR v_is_editor),
                'available_at', rel.available_at,
                -- Bodies are returned only when released (or to an editor). A
                -- locked item leaks its title + availability, never its content.
                'content_html',    CASE WHEN rel.released OR v_is_editor THEN i.content_html ELSE NULL END,
                'video_embed_url', CASE WHEN rel.released OR v_is_editor THEN i.video_embed_url ELSE NULL END,
                'video_provider',  CASE WHEN rel.released OR v_is_editor THEN i.video_provider ELSE NULL END,
                'attachments', CASE WHEN rel.released OR v_is_editor THEN COALESCE((
                    SELECT jsonb_agg(jsonb_build_object(
                             'id', a.id, 'kind', a.kind, 'position', a.position,
                             'url', a.url, 'label', a.label,
                             'file_name', a.file_name, 'mime_type', a.mime_type,
                             'size_bytes', a.size_bytes, 'storage_path', a.storage_path)
                           ORDER BY a.position)
                    FROM public.class_module_attachments a WHERE a.item_id = i.id), '[]'::jsonb)
                  ELSE '[]'::jsonb END
              ) AS item_json
            FROM public.class_module_items i,
                 LATERAL public.class_item_release(i.id, v_actor) rel
            WHERE i.section_id = s.id
              AND (v_is_editor OR i.status = 'published')
          ) items_q
        ), '[]'::jsonb)
      ) AS sec
    FROM public.class_module_sections s
    WHERE s.class_id = p_class_id
      AND (v_is_editor OR s.status = 'published')
  ) q;

  RETURN COALESCE(v_out, jsonb_build_object('sections', '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.get_class_curriculum_for_learner(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_class_curriculum_for_learner(uuid) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 6. Make the learner table-read gates RELEASE-AWARE (F1, closed in-PR).
--
--    Rather than leaving a permissive "published + enrolled" learner SELECT to
--    be removed later, we tighten it now so a locked (published-but-not-yet-
--    released) item can NEVER be read via raw PostgREST — not just hidden by the
--    read RPC. This is backward-compatible: every existing class is
--    'all_at_once' (released = true for all published items → identical to
--    today), and a by_date/drip/relative class can only be created via the new
--    frontend, so no old-client + locked-content combination exists during
--    rollout. Editors/admins keep full SELECT for authoring; the SECURITY
--    DEFINER read RPC bypasses RLS and still returns locked items' title +
--    availability for the "Available on…" UI.
--
--    Sections have no release of their own (items carry release), so the section
--    learner branch stays "published + entitled" — only the item BODIES are
--    gated. This folds in what would otherwise be a separate contract migration.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "cms_sections_select" ON public.class_module_sections;
CREATE POLICY "cms_sections_select" ON public.class_module_sections
  FOR SELECT TO authenticated
  USING (
    public.is_class_owner(class_id, auth.uid())
    OR public.has_role(auth.uid(), 'admin')
    OR (status = 'published' AND public.is_class_learner(class_id, auth.uid()))
  );

DROP POLICY IF EXISTS "cms_items_select" ON public.class_module_items;
CREATE POLICY "cms_items_select" ON public.class_module_items
  FOR SELECT TO authenticated
  USING (
    public.is_class_owner(class_id, auth.uid())
    OR public.has_role(auth.uid(), 'admin')
    OR (
      status = 'published'
      AND public.is_class_learner(class_id, auth.uid())
      AND (public.class_item_release(id, auth.uid())).released
    )
  );

DROP POLICY IF EXISTS "cma_select" ON public.class_module_attachments;
CREATE POLICY "cma_select" ON public.class_module_attachments
  FOR SELECT TO authenticated
  USING (
    public.is_class_owner(class_id, auth.uid())
    OR public.has_role(auth.uid(), 'admin')
    OR (
      public.is_class_learner(class_id, auth.uid())
      AND (public.class_item_release(item_id, auth.uid())).released
    )
  );

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
     AND (public.class_item_release(v_item, auth.uid())).released;
END $$;
REVOKE ALL ON FUNCTION public.can_read_class_module_file(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_read_class_module_file(text) TO authenticated, service_role;
