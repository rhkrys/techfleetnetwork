-- Audit Wave 1 — H12 / H13 / T-G: harden admin & teacher role-confirmation tokens.
--
-- H12: admin_promotions tokens never expired. Add expires_at (7-day life,
--      matching invitations); the confirm edge function enforces it + single-use.
-- H13: teacher_promotions used a PLAINTEXT token (the token_hash column existed
--      but was never populated; confirm-teacher-role read `.eq('token', ...)`).
--      Mirror the admin hardening (20260418032018): hash at rest via trigger,
--      verify via a SECURITY DEFINER RPC, add expiry + a hashed-lookup index.
-- T-G: enforced in the edge functions (POST + caller-JWT ownership proof). The DB
--      layer here supplies hashed lookup + expires_at so the fn can reject stale
--      links and never leak the plaintext token via a table read.
--
-- Idempotent + safe to re-run; no-op beyond DDL on a fresh CI reset (empty tables).

BEGIN;

-- ── admin_promotions: add expiry (H12) ───────────────────────────────────────
ALTER TABLE public.admin_promotions
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

-- Backfill pending rows so historical links get a bounded life (7 days from
-- creation). Already-confirmed rows are left NULL (irrelevant once consumed).
UPDATE public.admin_promotions
   SET expires_at = created_at + interval '7 days'
 WHERE expires_at IS NULL AND confirmed_at IS NULL;

-- New pending rows default to a 7-day life.
ALTER TABLE public.admin_promotions
  ALTER COLUMN expires_at SET DEFAULT (now() + interval '7 days');

-- The verifier must surface expires_at so the edge fn can reject stale links.
-- RETURNS TABLE shape changes -> DROP then CREATE.
DROP FUNCTION IF EXISTS public.verify_admin_promotion_token(text);
CREATE FUNCTION public.verify_admin_promotion_token(p_token text)
RETURNS TABLE(id uuid, user_id uuid, confirmed_at timestamptz, expires_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ap.id, ap.user_id, ap.confirmed_at, ap.expires_at
  FROM public.admin_promotions ap
  WHERE ap.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.verify_admin_promotion_token(text) FROM public, anon, authenticated;

-- ── teacher_promotions: hash at rest + expiry (H13, mirror the admin path) ────
ALTER TABLE public.teacher_promotions
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

UPDATE public.teacher_promotions
   SET expires_at = created_at + interval '7 days'
 WHERE expires_at IS NULL AND confirmed_at IS NULL;

ALTER TABLE public.teacher_promotions
  ALTER COLUMN expires_at SET DEFAULT (now() + interval '7 days');

-- Backfill token_hash for any pending row still holding only a plaintext token.
UPDATE public.teacher_promotions
   SET token_hash = encode(extensions.digest(token, 'sha256'), 'hex')
 WHERE token_hash IS NULL AND token IS NOT NULL;

-- Hash-at-rest trigger (mirror trg_hash_admin_promotion_token).
CREATE OR REPLACE FUNCTION public.trg_hash_teacher_promotion_token()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.token IS NOT NULL THEN
    NEW.token_hash := encode(extensions.digest(NEW.token, 'sha256'), 'hex');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS hash_teacher_promotion_token ON public.teacher_promotions;
CREATE TRIGGER hash_teacher_promotion_token
BEFORE INSERT OR UPDATE OF token ON public.teacher_promotions
FOR EACH ROW
EXECUTE FUNCTION public.trg_hash_teacher_promotion_token();

-- Hashed verifier (mirror verify_admin_promotion_token).
DROP FUNCTION IF EXISTS public.verify_teacher_promotion_token(text);
CREATE FUNCTION public.verify_teacher_promotion_token(p_token text)
RETURNS TABLE(id uuid, user_id uuid, confirmed_at timestamptz, expires_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT tp.id, tp.user_id, tp.confirmed_at, tp.expires_at
  FROM public.teacher_promotions tp
  WHERE tp.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.verify_teacher_promotion_token(text) FROM public, anon, authenticated;

-- Hashed-lookup index for pending rows (mirror admin).
CREATE INDEX IF NOT EXISTS idx_teacher_promotions_token_hash
  ON public.teacher_promotions (token_hash)
  WHERE confirmed_at IS NULL;

COMMIT;
