# Runbook — Resend delivery-event webhook (email deliverability observability)

Stand up the `resend-webhook` edge function so the platform stops sending blind:
Resend's post-send events (`bounced` / `complained` / `delivered`) are ingested
into `suppressed_emails` + `email_send_log`, which makes System Health →
Deliverability and the `refresh-email-health` auto-pause truthful.

**Why this exists:** the only prior bounce handler, `handle-email-suppression`,
is the pre-cutover **Lovable/Mailgun** version (`@lovable.dev/webhooks-js` +
unset `LOVABLE_API_KEY` → 500s on every call). Nothing ingested Resend events,
so bounces were invisible and mail could silently fail to deliver while the
dashboard showed 100% healthy. Found 2026-08-09 (the teacher-promotion incident).

**Security model (built to owasp-secure-coding-bdd):** the endpoint is public but
authenticated in code by the **Svix signature** (`RESEND_WEBHOOK_SECRET`). Every
request must pass verification _before_ any DB write — this blocks the abuse case
where a forged "bounce" event suppresses an arbitrary address (a targeted
deliverability lockout). Only hard `bounced`/`complained` events suppress;
`delivered`/`delivery_delayed` never restrict sending. Suppression is reversible
by an admin (§6) — it is never a dead end.

---

## 0. Prerequisites

- Supabase CLI linked to the live project (`supabase link --project-ref pzvqxdgoztbfikfuifix`), or dashboard access to Edge Functions.
- Resend dashboard access (owner/admin) for the `techfleet.org` account.
- Files already in the repo: `supabase/functions/resend-webhook/index.ts`, `supabase/config.toml` entry (`verify_jwt = false`).

## 1. Deploy the edge function

Preferred (once merged to `main`): the `deploy-edge-functions.yml` workflow ships
it automatically on changes under `supabase/functions/`.

Immediate / manual:

```bash
supabase functions deploy resend-webhook --project-ref pzvqxdgoztbfikfuifix
```

Verify it's reachable (should return **401 invalid signature** — that's correct:
unsigned requests are rejected, which proves the security gate is active):

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  https://pzvqxdgoztbfikfuifix.supabase.co/functions/v1/resend-webhook \
  -H "Content-Type: application/json" -d '{}'
# expect: 401   (500 = RESEND_WEBHOOK_SECRET not set yet → do §3 first; 404 = not deployed)
```

## 2. Create the webhook in Resend

Resend dashboard → **Webhooks → Add Endpoint**:

- **Endpoint URL:** `https://pzvqxdgoztbfikfuifix.supabase.co/functions/v1/resend-webhook`
- **Events:** `email.bounced`, `email.complained`, `email.delivered`
  (optionally `email.delivery_delayed` — it's logged, never suppresses)
- Save. Resend shows a **Signing Secret** of the form `whsec_…`. Copy it.

## 3. Set the signing secret (do NOT paste it into chat / commit it)

Dashboard: Project Settings → Edge Functions → **Secrets** → add
`RESEND_WEBHOOK_SECRET` = the `whsec_…` value.

Or CLI:

```bash
supabase secrets set RESEND_WEBHOOK_SECRET="whsec_xxxxxxxxxxxxxxxxxxxxxxxx" \
  --project-ref pzvqxdgoztbfikfuifix
```

Re-run the §1 curl — it must still return **401** (the function is up and now has
a secret to verify against). Never returns 200 for an unsigned body.

## 4. End-to-end verification with Resend's simulator (do this before trusting it)

Resend provides simulator recipients that deterministically trigger events.
Send test messages **through the app's own pipeline** (so the full path is
exercised), or from the Resend dashboard, to:

| Simulator address       | Fires event        | Expected result in our DB                                                        |
| ----------------------- | ------------------ | -------------------------------------------------------------------------------- |
| `bounced@resend.dev`    | `email.bounced`    | row in `suppressed_emails` (reason `bounce`) + `email_send_log` status `bounced` |
| `complained@resend.dev` | `email.complained` | `suppressed_emails` (reason `complaint`) + `email_send_log` status `complained`  |
| `delivered@resend.dev`  | `email.delivered`  | **no** suppression row (logged only)                                             |

Confirm ingestion (run ~30s after sending):

```sql
SELECT email, reason, created_at
FROM public.suppressed_emails
WHERE email LIKE '%@resend.dev'
ORDER BY created_at DESC;

SELECT recipient_email, status, error_message, created_at
FROM public.email_send_log
WHERE recipient_email LIKE '%@resend.dev'
ORDER BY created_at DESC
LIMIT 10;
```

Also check the function logs (Dashboard → Edge Functions → resend-webhook →
Logs): you should see `suppressed` / `ack` lines with the email **masked**
(`b***@resend.dev`) — never the full address (PII redaction working).

Clean up the simulator rows afterward (they'd otherwise block resend.dev):

```sql
DELETE FROM public.suppressed_emails WHERE email LIKE '%@resend.dev';
```

## 5. Fix the sending domain / From alignment (the deliverability half)

`resend-provider.ts` hardcodes `From: Tech Fleet <onboarding@techfleet.org>` and
**ignores** the `sender_domain: notify.techfleet.org` the app sets — a latent
DKIM/DMARC alignment risk.

1. Resend → **Domains**: confirm the domain you actually send from is **Verified**
   with **DKIM ✓ SPF ✓ DMARC ✓** (all green). Note which domain that is.
2. Set the edge secret `EMAIL_FROM_ADDRESS` to an address **on that verified,
   aligned domain** (e.g. `onboarding@techfleet.org` _only if_ `techfleet.org`
   is the aligned domain; otherwise `…@notify.techfleet.org`).
3. Resend → **Logs**: look up the 2026-08-03 21:02 announcement to
   `mdenner@techfleet.org` → its status (**Delivered / Bounced / Complained**)
   is the definitive verdict on the original non-receipt.

## 6. Recovery — un-suppress a wrongly-blocked recipient (lockout-prevention)

Suppression is reversible. If a legitimate recipient was suppressed in error:

```sql
DELETE FROM public.suppressed_emails WHERE email = lower('someone@example.com');
```

Future sends to that address resume immediately. (There is no auto-expiry;
removal is a deliberate admin action.)

## 7. Rollback

- **Disable ingestion:** in Resend → Webhooks, disable/delete the endpoint, or
  unset `RESEND_WEBHOOK_SECRET` (the function then fails closed with 500 and
  writes nothing).
- The function is additive; there is no schema to revert.

## 8. Follow-ups (not blocking)

- **Retire the dead handler:** `handle-email-suppression` (Lovable/Mailgun) is
  now superseded — safe to remove in a later cleanup PR.
- **Monitor the new pieces:** add `resend-webhook` presence and
  `resend-signup-confirmations-15m` to `environment_readiness()`'s expected set
  so they can't silently disappear (same pattern as migration 20260809120200).
- **Alert on suppression spikes:** `refresh-email-health` already auto-pauses
  bulk on bounce/complaint thresholds — now that it receives real data, confirm
  its Discord alert (`DISCORD_PROJECT_UPDATES_WEBHOOK`) is wired.

```

```
