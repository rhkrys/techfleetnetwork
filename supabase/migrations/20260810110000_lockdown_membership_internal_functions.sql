-- Close a least-privilege gap surfaced by supabase/tests/membership_ledger_test.sql
-- (test 18: "member cannot invoke compute_membership"), found 2026-08-09 the first
-- time the informational db-test job ran the suite end-to-end.
--
-- Root cause (grants layer, not code): 20260803120000_membership_ledger_projection
-- meant the projector + its internal/trigger helpers to be uncallable by members
-- ("never callable by members") and did:
--     REVOKE ALL ON FUNCTION ... FROM PUBLIC;
--     GRANT  EXECUTE ON compute_membership / reproject_membership_drift TO service_role;
-- But Supabase applies default privileges that GRANT EXECUTE on every new public
-- function to `anon` + `authenticated`, and `REVOKE ... FROM PUBLIC` does NOT remove
-- those role-specific grants. Net effect: compute_membership(uuid) — a SECURITY
-- DEFINER function that is the SOLE writer of profiles.membership_* — plus its
-- sibling internal/trigger functions remained EXECUTE-able by any authenticated
-- member, contradicting the stated security posture.
--
-- Fix at the proper (grants) layer: explicitly revoke EXECUTE from anon +
-- authenticated for exactly the five functions the projection migration intended to
-- lock down. Revoking EXECUTE from a role does NOT stop the trigger functions from
-- firing (trigger execution never checks the invoker's EXECUTE privilege), and
-- postgres/service_role retain EXECUTE, so all legitimate definer-context call paths
-- (triggers -> compute_membership, attach_gumroad_sale -> compute_membership) keep
-- working. The intentionally member-callable surface (attach_gumroad_sale,
-- membership_catalog_lookup, membership_health — each gated internally) is left
-- untouched. Idempotent: revoking an absent privilege is a no-op.

REVOKE EXECUTE ON FUNCTION public.compute_membership(uuid)            FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reproject_membership_drift()        FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.guard_profile_membership_columns()  FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_gumroad_sales_project()         FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_profile_resolve_pending()       FROM anon, authenticated;
