# Freescout secrets rotation runbook

Zero-downtime rotation for `FREESCOUT_API_KEY` and `FREESCOUT_WEBHOOK_SECRET`.

## API key (`FREESCOUT_API_KEY`)

1. In Freescout admin, generate a new admin API key. Keep the old key active.
2. Update the `FREESCOUT_API_KEY` secret in Lovable Cloud → Secrets.
3. Within ~60 seconds, redeploy `freescout-proxy`, `freescout-provision-admin`, `freescout-sync-customer`, `support-provisioning-retry`. (`supabase--deploy_edge_functions`)
4. Smoke test:
   - Member: open Get Help, expect ticket list to load.
   - Admin: open System Health → Help Desk, trigger "Provision now" on a test admin.
5. Revoke the old API key in Freescout.

If any step fails: roll back the secret to the previous value, redeploy, then investigate.

## Webhook secret (`FREESCOUT_WEBHOOK_SECRET`) — dual-secret window

The webhook verifier checks the request signature against `FREESCOUT_WEBHOOK_SECRET` first, then `FREESCOUT_WEBHOOK_SECRET_PREVIOUS` if set. This allows a 24-hour overlap window.

1. Set `FREESCOUT_WEBHOOK_SECRET_PREVIOUS` to the current value of `FREESCOUT_WEBHOOK_SECRET`.
2. Generate a new secret and set `FREESCOUT_WEBHOOK_SECRET` to the new value.
3. Redeploy `freescout-webhook`.
4. Update the webhook secret in the Freescout admin panel.
5. Watch `System Health → Help Desk → Recent webhook events` for ≥10 successful events on the new secret.
6. After 24 hours, delete `FREESCOUT_WEBHOOK_SECRET_PREVIOUS` and redeploy.

## Audit

Every rotation must be recorded in the project changelog with the timestamp, the operator, and the smoke-test results.
