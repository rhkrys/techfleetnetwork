
-- ── form_drafts: server-side draft persistence for every create form ──────
CREATE TABLE IF NOT EXISTS public.form_drafts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  draft_key       text NOT NULL,
  schema_version  integer NOT NULL DEFAULT 1,
  payload         jsonb NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  CONSTRAINT form_drafts_user_key_uniq UNIQUE (user_id, draft_key)
);

CREATE INDEX IF NOT EXISTS form_drafts_user_updated_idx
  ON public.form_drafts (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS form_drafts_expires_idx
  ON public.form_drafts (expires_at);

ALTER TABLE public.form_drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "form_drafts_select_own"
  ON public.form_drafts FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "form_drafts_insert_own"
  ON public.form_drafts FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "form_drafts_update_own"
  ON public.form_drafts FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "form_drafts_delete_own"
  ON public.form_drafts FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- Touch + cap + expiry refresh trigger
CREATE OR REPLACE FUNCTION public.form_drafts_touch()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF octet_length(NEW.payload::text) > 262144 THEN
    RAISE EXCEPTION 'form_drafts payload exceeds 256 KB cap (got % bytes)',
      octet_length(NEW.payload::text)
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  NEW.expires_at := now() + interval '14 days';
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS form_drafts_touch_trg ON public.form_drafts;
CREATE TRIGGER form_drafts_touch_trg
  BEFORE INSERT OR UPDATE ON public.form_drafts
  FOR EACH ROW EXECUTE FUNCTION public.form_drafts_touch();

-- Pruner (called by pg_cron)
CREATE OR REPLACE FUNCTION public.prune_expired_form_drafts()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  removed integer;
BEGIN
  DELETE FROM public.form_drafts WHERE expires_at < now();
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$;

REVOKE ALL ON FUNCTION public.prune_expired_form_drafts() FROM PUBLIC, anon, authenticated;

-- Daily cron at 03:17 UTC
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('prune-form-drafts')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'prune-form-drafts');
    PERFORM cron.schedule(
      'prune-form-drafts',
      '17 3 * * *',
      $cron$ SELECT public.prune_expired_form_drafts(); $cron$
    );
  END IF;
END $$;
