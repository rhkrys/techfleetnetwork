# Freescout config recovery

When the System Health → Help Desk banner is red, or members report the Get
Help page is stuck, the cause is almost always a bad `FREESCOUT_API_URL`
secret.

## Symptoms

- Banner reads "Help desk offline — Configuration error: …"
- `freescout-proxy` edge function logs show `code: "config_invalid"`
- Get Help page renders the "Help desk is reconnecting" card instead of
  spinning. (Pre-2026-06-01 it would crash-loop and spin forever — see
  `mem://features/get-help-resilience`.)

## Fix

1. Open **Lovable Cloud → Secrets** and verify `FREESCOUT_API_URL`.
2. The value MUST be:
   - exact format: `https://help.techfleet.network`
   - **no** trailing slash
   - **no** surrounding quotes or whitespace
   - scheme is **`https://`**, not `http://`
3. Save the secret.
4. In System Health → Help Desk, click **Re-test**. Banner flips to green
   within 3 seconds and shows the round-trip latency.
5. Refresh `/community/get-help` — tickets load normally.

## Why a permanent fix is in place

`supabase/functions/_shared/freescout.ts` validates the URL **lazily** —
it never throws at module load. A bad secret now:

- returns a clean 503 from `freescout-proxy`
- causes the Get Help page to render an offline state in ≤5 seconds (with
  a `mailto:info@techfleet.network` fallback)
- emits one structured log per cold start with `code: "config_invalid"`
  which routes into `agent_fix_queue` → 5-minute critical push to admins
- surfaces in System Health → Help Desk with the exact reason

So even if the secret is wrong again, no member is stranded and admins are
notified within minutes.
