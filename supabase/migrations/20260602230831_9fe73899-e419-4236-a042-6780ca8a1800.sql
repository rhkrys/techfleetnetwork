
-- Part 2 §A2 / §B2 / §G1 — additive columns; no behavior change for existing rows.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS onboarded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dashboard_layout_version SMALLINT NOT NULL DEFAULT 1;

COMMENT ON COLUMN public.profiles.onboarded_at IS
  'Set once when the member completes the /welcome wizard. NULL = gate the wizard.';
COMMENT ON COLUMN public.profiles.dashboard_layout_version IS
  'Drives evolving dashboard: 1=first-session minimal, 2+=expanded as user progresses.';

ALTER TABLE public.general_applications
  ADD COLUMN IF NOT EXISTS draft_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS draft_updated_at TIMESTAMPTZ;

COMMENT ON COLUMN public.general_applications.draft_state IS
  'Per-user autosaved draft answers; flushed on submit. Powers Resume application banner (Part 2 §G1).';

-- Lightweight maintenance trigger: keep draft_updated_at fresh on draft writes.
CREATE OR REPLACE FUNCTION public.general_applications_touch_draft()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.draft_state IS DISTINCT FROM OLD.draft_state THEN
    NEW.draft_updated_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_general_applications_touch_draft ON public.general_applications;
CREATE TRIGGER trg_general_applications_touch_draft
  BEFORE UPDATE ON public.general_applications
  FOR EACH ROW
  EXECUTE FUNCTION public.general_applications_touch_draft();
