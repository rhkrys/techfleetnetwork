-- Polish (#7): scale the nightly/weekly drift sweep for ~10k users.
--
-- reproject_membership_drift() previously re-projected EVERY profile (an O(n)
-- compute_membership call per row). A profile that is already 'starter' AND has
-- no resolved gumroad_sales is provably correct (compute_membership returns
-- 'starter' when there is no active sale), so re-checking it can never find
-- drift. Scoping loop 2 to profiles that are non-starter OR have at least one
-- sale cuts the sweep from all N profiles to just the membership-relevant subset
-- (hundreds, not thousands) with ZERO change in correctness. The tripwire (loop
-- 1) is unchanged. Behavior otherwise identical to 20260803150000.
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

  -- Drift check, scoped: a starter profile with no sales is provably correct, so
  -- only re-project profiles that are non-starter OR have any sale on file.
  FOR r IN
    SELECT p.user_id, p.membership_tier
      FROM public.profiles p
     WHERE p.membership_tier <> 'starter'
        OR EXISTS (SELECT 1 FROM public.gumroad_sales gs WHERE gs.resolved_user_id = p.user_id)
  LOOP
    IF public.compute_membership(r.user_id) IS DISTINCT FROM r.membership_tier THEN
      v_fixed := v_fixed + 1;
    END IF;
  END LOOP;
  RETURN v_fixed;
END
$$;

REVOKE ALL ON FUNCTION public.reproject_membership_drift() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.reproject_membership_drift() TO service_role;
