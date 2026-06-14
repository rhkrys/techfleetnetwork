## Problem
Production users on cached bundle `index-DI5FAA9R.js` are calling the legacy 1-arg `get_dashboard_overview(p_user_id)`. Database only has the 0-arg version (post-refactor), so PostgREST returns `PGRST202` "function not found in schema cache" and the dashboard fails to load. This is the same fingerprint that was auto-closed last week — it keeps recurring whenever a member returns with a stale HTML/JS pair.

## Root Cause
Removing the 1-arg overload was a breaking change for any tab that loaded the app before the refactor and hasn't refreshed. `<UpdateAvailableBanner/>` only nudges; it doesn't force a refresh, so cached bundles can survive for days.

## Permanent Fix
Add a thin backward-compatible 1-arg overload that delegates to the canonical 0-arg version. This:
- Restores the dashboard for every stale tab immediately, with no user action.
- Costs nothing at runtime (single function call passthrough).
- Future-proofs against the next time we refactor the signature — old bundles keep working until they naturally refresh.

### Migration
```sql
CREATE OR REPLACE FUNCTION public.get_dashboard_overview(p_user_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- Back-compat shim for cached bundles that still pass p_user_id.
  -- Canonical implementation is the 0-arg overload, which reads auth.uid().
  -- p_user_id is intentionally ignored to prevent privilege escalation.
  SELECT public.get_dashboard_overview();
$$;

REVOKE ALL ON FUNCTION public.get_dashboard_overview(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_dashboard_overview(uuid) TO authenticated, service_role;
```

### Auto-resolve stale queue rows
Re-run `resolve_stale_fingerprints_on_deploy('%get_dashboard_overview(p_user_id)%', 'permanent 1-arg shim deployed')`.

### BDD
Insert `DASHBOARD-RPC-COMPAT-001`:
- Given a member is on a cached bundle calling `get_dashboard_overview(p_user_id)`
- When the dashboard loads
- Then [UI] dashboard renders with no error toast
- Then [DB] PostgREST resolves the 1-arg overload and returns the same JSON as the 0-arg form
- Then [Code] no `PGRST202`/`schema cache` error is reported to `agent_fix_queue`

### Memory
Add `mem://constraints/rpc-signature-backcompat`: "Never remove an RPC argument signature without leaving a shim overload — cached browser bundles keep calling the old shape for days. Add the shim in the same migration as the refactor."

## Out of Scope
- Source code: no changes needed (`use-dashboard-overview.ts` already calls 0-arg).
- Auth, RLS, profiles, journey_progress, course_completions: untouched.
- Deploy-watcher behavior: unchanged (per `mem://features/no-auto-reload-on-deploy`).