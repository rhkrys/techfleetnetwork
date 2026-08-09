-- Audit T-A: `profiles.id` vs `auth.uid()` identity confusion in the Freescout
-- support-provisioning subsystem (the unfinished sibling of C3, which fixed the
-- support *ticket* tables in 20260808140000).
--
-- Canonical identity across this platform is the AUTH uid = `profiles.user_id`,
-- NOT the random `profiles.id` PK. `support_provisioning_log.user_id` has no FK
-- and had MIXED contents:
--   * customer rows (profile trigger, batch/backfill, edge fns) stored profiles.id
--   * admin rows (user_roles trigger, backfill) stored the auth uid
-- and two lookups were silently broken because they compared the two:
--   * trg_fn_user_roles_provision_admin: `WHERE id = NEW.user_id` (skip-check
--     never matched -> re-enqueued admins forever)
--   * support_backfill_provisioning admins: `JOIN profiles p ON p.id = ur.user_id`
--     (never matched -> admin backfill enqueued nobody)
--   * support-provisioning-retry read `.eq("id", row.user_id)` -> admin rows
--     never resolved (edge fn, fixed in the same PR).
--
-- This migration standardizes the log on the AUTH uid: it (1) redefines the two
-- trigger fns and the backfill fn to write/read `user_id` (auth uid), and (2)
-- repairs existing rows that hold a profiles.id -> profiles.user_id. Idempotent /
-- re-runnable. Edge functions in the same PR are updated to match.

-- ── 1. Customer provisioning trigger — enqueue the auth uid, not the PK ───────
CREATE OR REPLACE FUNCTION public.trg_fn_profiles_provision_customer()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.email IS NOT NULL
     AND length(trim(NEW.email)) > 0
     AND NEW.freescout_customer_id IS NULL THEN
    -- NEW.user_id is the auth uid; was NEW.id (the profiles PK) — audit T-A.
    PERFORM public.enqueue_freescout_provisioning(NEW.user_id, 'customer');
  END IF;
  RETURN NEW;
END;
$$;

-- ── 2. Admin provisioning trigger — fix the skip-check lookup ─────────────────
CREATE OR REPLACE FUNCTION public.trg_fn_user_roles_provision_admin()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_has_id text;
BEGIN
  IF NEW.role <> 'admin'::public.app_role THEN
    RETURN NEW;
  END IF;

  -- Look up by user_id (auth uid); was `WHERE id = NEW.user_id`, which never
  -- matched (profiles.id <> auth.uid()) so the "already provisioned" skip-check
  -- was dead and every admin grant re-enqueued — audit T-A.
  SELECT freescout_user_id INTO v_has_id
    FROM public.profiles
   WHERE user_id = NEW.user_id;

  IF v_has_id IS NULL OR length(trim(v_has_id)) = 0 THEN
    PERFORM public.enqueue_freescout_provisioning(NEW.user_id, 'admin_user');
  END IF;

  RETURN NEW;
END;
$$;

-- ── 3. Backfill RPC — members enqueue auth uid; admin join keyed on user_id ───
CREATE OR REPLACE FUNCTION public.support_backfill_provisioning(_mode text)
RETURNS TABLE (queued integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  _n integer := 0;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF _mode = 'admins' THEN
    INSERT INTO public.support_provisioning_log(user_id, kind, status, attempts, last_error)
    SELECT ur.user_id, 'admin_user', 'retry', 0, 'queued via backfill'
    FROM public.user_roles ur
    LEFT JOIN public.profiles p ON p.user_id = ur.user_id   -- was p.id = ur.user_id (T-A)
    WHERE ur.role = 'admin'::public.app_role
      AND (p.freescout_user_id IS NULL);
    GET DIAGNOSTICS _n = ROW_COUNT;
  ELSIF _mode = 'members' THEN
    INSERT INTO public.support_provisioning_log(user_id, kind, status, attempts, last_error)
    SELECT p.user_id, 'customer', 'retry', 0, 'queued via backfill'   -- was p.id (T-A)
    FROM public.profiles p
    WHERE p.freescout_customer_id IS NULL;
    GET DIAGNOSTICS _n = ROW_COUNT;
  ELSE
    RAISE EXCEPTION 'invalid_mode' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY SELECT _n;
END;
$$;
REVOKE ALL ON FUNCTION public.support_backfill_provisioning(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.support_backfill_provisioning(text) TO authenticated, service_role;

-- ── 4. Data repair — convert existing rows that hold a profiles.id to the uid ─
-- support_provisioning_log is append-only (trg_support_prov_log_no_update). This
-- is a controlled, one-time identity repair, not tampering, so we disable the
-- guard around exactly this UPDATE (mirrors support_prune_webhook_events).
-- Rows already holding the auth uid don't match `spl.user_id = p.id` and are left
-- untouched; orphaned rows (deleted profiles) are left as-is. Idempotent.
ALTER TABLE public.support_provisioning_log DISABLE TRIGGER trg_support_prov_log_no_update;
UPDATE public.support_provisioning_log spl
   SET user_id = p.user_id
  FROM public.profiles p
 WHERE spl.user_id = p.id
   AND spl.user_id <> p.user_id;
ALTER TABLE public.support_provisioning_log ENABLE TRIGGER trg_support_prov_log_no_update;
