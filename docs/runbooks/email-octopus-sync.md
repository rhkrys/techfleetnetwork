# Runbook — Email Octopus marketing sync

Operational runbook for the EO sync worker (`email-octopus-sync`) that pushes member marketing
opt-in/out to Email Octopus. Design: [ADR-0017](../adr/0017-email-octopus-marketing-source-of-truth.md).
EO is the source of truth; the platform is the front door. Opt-in/out is recorded in
`public.email_octopus_contact_sync` (an outbox) and pushed to EO with retry/backoff, off the user path.

**SLOs:** EO sync success rate > 99%; opt-out → EO propagation p95 < 5 min; retry backlog trends to ~0.

## Alerts

- **Unsubscribe/delete backlog (PAGE, SEV2).** `get_eo_sync_health().pending_optout` or `.dlq_optout`
  above threshold means members who opted OUT are still subscribed in EO — a **compliance breach in
  progress** (still being marketed to after opting out). Treat as urgent.
- **General backlog / oldest_pending_secs high (SEV3).** Opt-INS not propagating; not a breach, but the
  worker is behind.
- **EO API error-rate spike (SEV3).** Rising `record_eo_sync_result` retries/DLQ with EO 4xx/5xx.

## First: is it disabled, behind, or failing?

Query health as service role:

```sql
select * from public.get_eo_sync_health();
-- pending, pending_optout, dlq, dlq_optout, oldest_pending_secs
```

1. **Everything pending, nothing syncing?** The worker is likely **disabled**: `EMAILOCTOPUS_API_KEY`
   / `EMAILOCTOPUS_LIST_ID` absent → the function returns `{disabled:true}` and no-ops (fails closed).
   Confirm the secrets are set in Supabase, and that the `email-octopus-sync` pg_cron job exists
   (`select * from cron.job where jobname='email-octopus-sync'`). No secrets = intents pile up safely;
   set them and the backlog drains.
2. **Rows stuck in `syncing`?** A worker crashed mid-flight. `reclaim_stale_eo_sync(300)` returns them
   to `pending` at the start of every run; if the cron is not firing, run the worker once manually
   (POST to `/functions/v1/email-octopus-sync` with the service-role bearer).
3. **Rows in `dlq`?** Permanent EO rejections (422/400) or 8 exhausted attempts. Inspect
   `last_error` / `last_status_code` / `attempt_history` on the DLQ rows.

## Diagnose by symptom

- **EO down / 5xx / 429:** the client maps these to `retry`; the queue holds and drains on recovery.
  The **user path stays up** (signup/profile-save committed locally, fail-open). No action unless the
  outage outlives the opt-out SLO — then treat the unsub backlog as the SEV2 above and, if EO is out
  for long, note it as a known compliance-delay incident.
- **401/403 from EO:** bad/rotated key. These map to `retry` (not DLQ) so nothing is lost — fix the key
  and the backlog drains. See rotation below.
- **422 for specific contacts:** invalid email or an unknown custom field. If it is the field tag,
  ensure `EMAILOCTOPUS_FIRSTNAME_FIELD` matches a real field tag on the list, or unset it (the client
  then sends no custom fields). Re-queue the DLQ rows after fixing.

## Recover

- **Replay DLQ:** re-queue by resetting the rows (service role):
  ```sql
  update public.email_octopus_contact_sync
     set status='pending', attempts=0, next_attempt_at=now(), dlq_reason=null
   where status='dlq';
  ```
  The worker picks them up on the next tick. (Prefer fixing the root cause first, or they DLQ again.)
- **Force a drain now:** POST `/functions/v1/email-octopus-sync` with the service-role bearer.

## Rotate the EO API key / webhook secret

1. Create the new key in EO (Integrations & API).
2. Update `EMAILOCTOPUS_API_KEY` in Supabase secrets. In-flight rows on the old key were `retry` (never
   dropped) and drain once the new key is live.
3. If/when the EO → platform webhook ships, rotate `EMAILOCTOPUS_WEBHOOK_SECRET` the same way.

## Reconcile a drifted toggle

The preference toggle displays a **live per-user read from EO** (`eo-contact-status`) on page load, so
it reflects the true EO state — including subscribes/unsubscribes made outside the platform. If EO is
unavailable, it falls back to the cached sync row (`get_my_marketing_subscription`), which may briefly
lag an EO-side change until EO is reachable again. No webhook is used.
