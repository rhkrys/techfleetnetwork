-- ============================================================================
-- Eager Freescout provisioning + bulk email peak pacing
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Helper: enqueue a provisioning attempt (writes to support_provisioning_log)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enqueue_freescout_provisioning(
  _user_id uuid,
  _kind text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _kind NOT IN ('customer', 'admin_user') THEN
    RAISE EXCEPTION 'invalid kind: %', _kind;
  END IF;

  -- Insert a "retry" row (attempts=0) so the cron worker picks it up on next tick.
  -- The cron worker is idempotent — it no-ops if profiles.* id is already set.
  INSERT INTO public.support_provisioning_log(user_id, kind, status, attempts, last_error)
  VALUES (_user_id, _kind, 'retry', 0, 'queued via trigger');
EXCEPTION WHEN OTHERS THEN
  -- Never block the originating insert (profile/role) on a provisioning hiccup.
  RAISE NOTICE 'enqueue_freescout_provisioning swallowed: %', SQLERRM;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_freescout_provisioning(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_freescout_provisioning(uuid, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 2. Trigger fn + trigger: provision Freescout customer on new profile
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_fn_profiles_provision_customer()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only queue when we have an email and no existing Freescout customer id.
  IF NEW.email IS NOT NULL
     AND length(trim(NEW.email)) > 0
     AND NEW.freescout_customer_id IS NULL THEN
    PERFORM public.enqueue_freescout_provisioning(NEW.id, 'customer');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_provision_customer ON public.profiles;
CREATE TRIGGER trg_profiles_provision_customer
  AFTER INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_fn_profiles_provision_customer();

-- ---------------------------------------------------------------------------
-- 3. Trigger fn + trigger: provision Freescout staff user on admin role grant
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_fn_user_roles_provision_admin()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_has_id text;
BEGIN
  IF NEW.role <> 'admin'::app_role THEN
    RETURN NEW;
  END IF;

  -- Skip if already provisioned.
  SELECT freescout_user_id INTO v_has_id
    FROM public.profiles
   WHERE id = NEW.user_id;

  IF v_has_id IS NULL OR length(trim(v_has_id)) = 0 THEN
    PERFORM public.enqueue_freescout_provisioning(NEW.user_id, 'admin_user');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_user_roles_provision_admin ON public.user_roles;
CREATE TRIGGER trg_user_roles_provision_admin
  AFTER INSERT ON public.user_roles
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_fn_user_roles_provision_admin();

-- ---------------------------------------------------------------------------
-- 4. Backfill: enqueue every existing un-provisioned member + admin
--    The support-provisioning-retry cron (every minute, 25/run) will drain.
-- ---------------------------------------------------------------------------
INSERT INTO public.support_provisioning_log(user_id, kind, status, attempts, last_error)
SELECT p.id, 'customer', 'retry', 0, 'queued via batch backfill 2026-06-03'
  FROM public.profiles p
 WHERE p.email IS NOT NULL
   AND length(trim(p.email)) > 0
   AND p.freescout_customer_id IS NULL
   -- Don't double-enqueue if a retry row already exists.
   AND NOT EXISTS (
     SELECT 1 FROM public.support_provisioning_log spl
      WHERE spl.user_id = p.id
        AND spl.kind = 'customer'
        AND spl.status = 'retry'
   );

INSERT INTO public.support_provisioning_log(user_id, kind, status, attempts, last_error)
SELECT ur.user_id, 'admin_user', 'retry', 0, 'queued via batch backfill 2026-06-03'
  FROM public.user_roles ur
  JOIN public.profiles p ON p.id = ur.user_id
 WHERE ur.role = 'admin'::app_role
   AND (p.freescout_user_id IS NULL OR length(trim(p.freescout_user_id)) = 0)
   AND NOT EXISTS (
     SELECT 1 FROM public.support_provisioning_log spl
      WHERE spl.user_id = ur.user_id
        AND spl.kind = 'admin_user'
        AND spl.status = 'retry'
   );

-- ---------------------------------------------------------------------------
-- 5. Bulk email lane peak-hour pacing knobs
-- ---------------------------------------------------------------------------
ALTER TABLE public.email_send_state
  ADD COLUMN IF NOT EXISTS bulk_send_delay_peak_ms integer NOT NULL DEFAULT 900;

ALTER TABLE public.email_send_state
  ADD COLUMN IF NOT EXISTS bulk_peak_hours_utc integer[] NOT NULL DEFAULT ARRAY[18,19,20,21]::integer[];

COMMENT ON COLUMN public.email_send_state.bulk_send_delay_peak_ms IS
  'Inter-send delay (ms) used by process-email-queue bulk lane during peak hours (UTC). Defaults to 900ms.';
COMMENT ON COLUMN public.email_send_state.bulk_peak_hours_utc IS
  'Hours (0-23, UTC) when the bulk lane uses bulk_send_delay_peak_ms instead of bulk_send_delay_ms.';
