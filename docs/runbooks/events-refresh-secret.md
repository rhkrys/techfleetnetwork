# Runbook: provision the events-refresh trigger secret

Decouples the community-events refresh trigger from the rotating service-role key
(see `docs/audits/events-calendar-audit-2026-08.md`). Until these steps are done,
the calendar keeps working via the service-role fallback — this is a hardening
step, not a fix for an outage.

## Why

The cron→function refresh authenticated with the project **service-role key**,
which is duplicated across Vault, the function's injected env, and the dashboard,
and changes on rotation/cutover. Any drift silently 403s the refresh. A dedicated
`EVENTS_REFRESH_SECRET` that is **not** the service-role key means rotating the
service-role key can never break the calendar trigger again.

## One-time provisioning

1. **Generate a random secret** (keep it out of chat/logs):

   ```bash
   openssl rand -hex 32
   ```

2. **Set it as the function env secret** (injected into the edge function):

   ```bash
   supabase secrets set EVENTS_REFRESH_SECRET=<value> --project-ref pzvqxdgoztbfikfuifix
   ```

3. **Store the same value in Vault** (what the cron sends), via the SQL editor:

   ```sql
   SELECT vault.create_secret('<value>', 'events_refresh_secret');
   ```

   (If it already exists: `SELECT vault.update_secret((SELECT id FROM vault.secrets WHERE name='events_refresh_secret'), '<value>');`)

4. **Redeploy edge functions** so `EVENTS_REFRESH_SECRET` is injected:
   GitHub → Actions → **Deploy edge functions** → Run workflow (deploy_all = true).

5. **Verify** the cron path now authenticates with the dedicated secret:
   ```sql
   SELECT public.kick_community_events_refresh();
   -- wait ~30–60s
   SELECT last_refresh_status,
          round(extract(epoch FROM (now()-fetched_at))/60,1) AS mins_stale
   FROM public.community_events_cache WHERE id = 1;   -- expect ok / ~0
   ```

## After provisioning

Rotating the service-role key no longer touches the calendar. The service-role
key remains accepted as a break-glass path (`refresh-community-events/auth.ts`),
so nothing hard-fails if the dedicated secret is ever cleared.

## Watchdog

`community_events_staleness_check()` runs every 15 min and raises an
`external_api_failed` audit event (visible in System Health → Silent Failures)
whenever the cache is >30 min stale or in an error state — so a future breakage
is loud, not silent.
