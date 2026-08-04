-- Support ticket categories (PR #2a). Admin-managed reference data + a per-ticket
-- category on the pointer + category-based monthly reporting. Categories are the
-- foundation the scoped-agent RBAC (PR #2b) will build on.

-- ── Category table ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.support_categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key         text NOT NULL UNIQUE,
  label       text NOT NULL,
  description text,
  sort_order  integer NOT NULL DEFAULT 100,
  is_internal boolean NOT NULL DEFAULT false,  -- hide from members when true
  is_active   boolean NOT NULL DEFAULT true,   -- soft-delete
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.support_categories ENABLE ROW LEVEL SECURITY;

-- Members may read active, non-internal categories (labels for their own ticket);
-- admins read everything (incl. internal + retired) for the management UI.
DROP POLICY IF EXISTS "read support categories" ON public.support_categories;
CREATE POLICY "read support categories" ON public.support_categories
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR (is_active AND NOT is_internal)
  );

-- Admins manage the taxonomy directly (low-risk reference data). Deletes are
-- soft (set is_active = false) so historical tickets keep a resolvable label.
DROP POLICY IF EXISTS "admins insert support categories" ON public.support_categories;
CREATE POLICY "admins insert support categories" ON public.support_categories
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "admins update support categories" ON public.support_categories;
CREATE POLICY "admins update support categories" ON public.support_categories
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

GRANT SELECT, INSERT, UPDATE ON public.support_categories TO authenticated;
GRANT ALL ON public.support_categories TO service_role;

-- Keep updated_at fresh on edits.
CREATE OR REPLACE FUNCTION public.touch_support_categories_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS trg_touch_support_categories ON public.support_categories;
CREATE TRIGGER trg_touch_support_categories
  BEFORE UPDATE ON public.support_categories
  FOR EACH ROW EXECUTE FUNCTION public.touch_support_categories_updated_at();

-- ── Per-ticket category ────────────────────────────────────────────────────
ALTER TABLE public.support_ticket_pointers
  ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES public.support_categories(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_support_ticket_pointers_category
  ON public.support_ticket_pointers (category_id);

-- ── Seed taxonomy (Tech Fleet's list; alphabetical, "Other" last) ──────────
INSERT INTO public.support_categories (key, label, sort_order) VALUES
  ('advice',              'Advice',              10),
  ('billing',             'Billing',             20),
  ('classes',             'Classes',             30),
  ('code_of_conduct',     'Code of Conduct',     40),
  ('conflict_escalation', 'Conflict Escalation', 50),
  ('discord',             'Discord',             60),
  ('figma_verification',  'Figma Verification',  70),
  ('membership',          'Membership',          80),
  ('onboarding',          'Onboarding',          90),
  ('projects',            'Projects',           100),
  ('safety',              'Safety',             110),
  ('technical_help',      'Technical Help',     120),
  ('other',               'Other',             9999)
ON CONFLICT (key) DO NOTHING;

-- ── Category-based monthly report (admin-gated) ────────────────────────────
CREATE OR REPLACE FUNCTION public.get_support_category_report(
  _from date DEFAULT (now() - interval '12 months')::date
)
RETURNS TABLE (month text, category text, ticket_count bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    SELECT to_char(date_trunc('month', p.created_at), 'YYYY-MM') AS month,
           COALESCE(c.label, 'Uncategorized')                    AS category,
           count(*)::bigint                                      AS ticket_count
      FROM public.support_ticket_pointers p
      LEFT JOIN public.support_categories c ON c.id = p.category_id
     WHERE p.created_at >= _from
     GROUP BY 1, 2
     ORDER BY 1 DESC, 2;
END
$$;

REVOKE ALL ON FUNCTION public.get_support_category_report(date) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_support_category_report(date) TO authenticated, service_role;
