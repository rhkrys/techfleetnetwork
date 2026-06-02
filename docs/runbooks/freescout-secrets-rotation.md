# Freescout secrets rotation runbook

Zero-downtime rotation for `FREESCOUT_API_KEY` and `FREESCOUT_WEBHOOK_SECRET`.

## API key (`FREESCOUT_API_KEY`)

The secret is **live-validated at entry** by the `freescout-validate-secret` edge function. A bad key is rejected before it is written.

1. In Freescout admin, generate a new admin API key. Keep the old key active.
2. In the admin Settings → Secrets UI, paste the new key. The UI calls `freescout-validate-secret`; the secret is only saved if Freescout returns 200 and `DEFAULT_MAILBOX_ID` is present in the mailboxes list.
3. Smoke test:
   - Member: open Get Help, expect the ticket list to load.
   - Admin: open System Health → Help Desk and run a test backfill.
4. Revoke the old API key in Freescout.

## Mailbox ID

The mailbox is a **code constant** (`DEFAULT_MAILBOX_ID` in `supabase/functions/_shared/freescout.ts`). To change it, open a PR updating the const, then rotate the API key so `freescout-validate-secret` re-confirms the new mailbox is reachable.



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
