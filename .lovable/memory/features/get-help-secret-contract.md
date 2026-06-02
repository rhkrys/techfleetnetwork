---
name: Get Help secret contract
description: Freescout base URL + mailbox ID are code constants; API key is live-validated at secret entry; no runtime config branch exists
type: feature
---

The Freescout integration removes the entire "what if the secret is wrong" failure class at the source:

- `FREESCOUT_BASE_URL = "https://meteoric-hare.pikapod.net"` and `DEFAULT_MAILBOX_ID = 1` live as `const`s in `supabase/functions/_shared/freescout.ts`. A code change (PR) is the only way to alter them. There is no env read for base URL or mailbox.
- The only runtime input is `FREESCOUT_API_KEY`. Module load throws `FREESCOUT_API_KEY missing — refuse to boot` if it's absent. This is a catastrophic tripwire only.
- Admin Settings → Secrets calls `freescout-validate-secret` BEFORE writing the secret. It probes `GET /api/mailboxes` against the constant base URL with a 3s timeout and accepts only if 200 + `DEFAULT_MAILBOX_ID` is present in the response. A bad key is never saved.
- No `getFreescoutConfig`, no URL normalization, no 503/`degraded:true` envelope, no `freescout-health` probe, no "reconnecting" UI. If Freescout is genuinely down, the standard error card renders (real error class).

To change mailbox: open a PR updating `DEFAULT_MAILBOX_ID`. Then rotate the API key via `update_secret(["FREESCOUT_API_KEY"])` so validate-secret re-confirms the mailbox is reachable with the current key.

BDD: HELP-DESK-010 (invalid key rejected at entry), HELP-DESK-011 (Get Help renders <2s p95 with valid key).
