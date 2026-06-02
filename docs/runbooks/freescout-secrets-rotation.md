# Freescout secrets rotation runbook

Zero-downtime rotation for `FREESCOUT_API_KEY` and `FREESCOUT_WEBHOOK_SECRET`.

## API key (`FREESCOUT_API_KEY`)

The `freescout-validate-secret` edge function is the live-probe contract — it confirms the candidate key authenticates AND that `DEFAULT_MAILBOX_ID` is reachable, before any rotation goes live.

1. In Freescout admin, generate a new admin API key. Keep the old key active.
2. **Pre-flight (mandatory):** run the validator with the candidate key, signed in as an admin:
   ```bash
   curl -sS -X POST "https://iqsjhrhsjlgjiaedzmtz.supabase.co/functions/v1/freescout-validate-secret" \
     -H "Authorization: Bearer $ADMIN_JWT" -H "Content-Type: application/json" \
     -d "$(jq -nc --arg k "$NEW_KEY" '{candidateApiKey:$k}')"
   ```
   Proceed only if the response is `{"ok": true, "mailboxId": <DEFAULT_MAILBOX_ID>, ...}`. Any other response means the key is bad or the mailbox const is wrong — do not save the secret.
3. Update the `FREESCOUT_API_KEY` secret in Lovable Cloud → Connectors with the validated key.
4. Smoke test:
   - Member: open Get Help, expect the ticket list to load.
   - Admin: open System Health → Help Desk and run a test backfill.
5. Revoke the old API key in Freescout.



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
