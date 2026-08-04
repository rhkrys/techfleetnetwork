-- Tag the membership invariant-violation tripwire with explicit severity:error +
-- source, so it classifies correctly in the Activity Log (as an Error, DB layer)
-- regardless of frontend inference. Behavior otherwise identical to the version
-- in 20260803120000_membership_ledger_projection.sql.
CREATE OR REPLACE FUNCTION public.reproject_membership_drift()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_fixed integer := 0;
  r record;
BEGIN
  -- Tripwire: paid profiles with no active backing sale (bug or tampering).
  FOR r IN
    SELECT p.user_id, p.membership_tier
      FROM public.profiles p
     WHERE p.membership_tier <> 'starter'
       AND NOT EXISTS (
         SELECT 1 FROM public.gumroad_sales gs
          WHERE gs.resolved_user_id = p.user_id
            AND gs.refunded_at IS NULL AND gs.disputed_at IS NULL
            AND gs.subscription_ended_at IS NULL)
  LOOP
    PERFORM public.write_audit_log(
      'membership_invariant_violation', 'profiles', r.user_id::text, NULL,
      ARRAY['severity:error', 'source:db.membership',
            'tier:' || r.membership_tier::text, 'reason:no_backing_active_sale'], NULL);
  END LOOP;

  FOR r IN SELECT user_id, membership_tier FROM public.profiles LOOP
    IF public.compute_membership(r.user_id) IS DISTINCT FROM r.membership_tier THEN
      v_fixed := v_fixed + 1;
    END IF;
  END LOOP;
  RETURN v_fixed;
END
$$;

REVOKE ALL ON FUNCTION public.reproject_membership_drift() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.reproject_membership_drift() TO service_role;
