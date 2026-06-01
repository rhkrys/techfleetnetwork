## Root cause

`supabase/functions/_shared/freescout.ts:15-18` throws **at module load** when `FREESCOUT_API_URL` does not start with `https://`. Edge-function logs confirm `freescout-proxy` is crash-looping with `event loop error: Error: FREESCOUT_API_URL must be https://` on every invocation in the last hour.

Consequence chain:
1. The isolate crashes during boot → no handler is ever registered → the runtime closes the connection without a body.
2. `supabase.functions.invoke("freescout-proxy")` from `GetHelpPage` and `NewTicketDialog` returns a generic error after the SDK's retries — users see "Could not create your ticket" and the listings spinner appears to hang.
3. Because the throw happens in a **shared** module, ANY future edge function that imports `_shared/freescout.ts` will also crash-loop the moment the URL is misconfigured.

The secret `FREESCOUT_API_URL` is present (per `fetch_secrets`) but its value is invalid — almost certainly `http://...` or has a leading space/character that survived `.trim()` but failed `^https://`.

## The three real weaknesses

| # | Weakness | Why it caused the incident |
|---|----------|----------------------------|
| 1 | **Top-level `throw` in shared module** | One bad env var bricks every consumer at import time, before CORS, before logging, before any error response can be returned. |
| 2 | **No startup self-check / no admin signal** | Admins had no in-app visibility — the only trace was raw edge-function logs. |
| 3 | **Client treats backend outage as a hang** | `useTickets` has no timeout and no `retry`/`enabled` cap. Users wait through SDK retries; the page feels broken instead of degraded. |

## Plan (ship all of it in one go)

### 1. Refactor `_shared/freescout.ts` — never throw at module load

- Replace the top-level `throw` with a lazy validator `getFreescoutConfig()` that returns `{ ok: true, base, key, host }` or `{ ok: false, reason }`.
- `assertConfigured()` becomes the single gate inside `freescoutFetch` and throws a typed `FreescoutError(503, "support_unavailable", { reason })` — never an uncaught exception.
- Accept `RAW_BASE` regardless of trailing slashes / casing, validate scheme with `new URL(...)` (catches all malformed inputs, not just non-https), and reject anything except `https:`.
- Result: a bad/missing secret degrades to a clean 503 JSON response with CORS headers, not a dead isolate.

### 2. Harden `freescout-proxy/index.ts`

- Wrap the body of `Deno.serve` so any `FreescoutError` with status 503 returns:
  ```json
  { "items": [], "unavailable": true, "reason": "support_unavailable" }
  ```
  with `Retry-After: 30` and 200 status for **list** actions (so the UI can render the empty state immediately) and 503 for **mutating** actions (`create`, `reply`, `close`, etc.) so the user sees a real error instead of a fake success.
- Add a structured log line `{ level: "error", fn: "freescout-proxy", code: "config_invalid", reason }` once per cold start — feeds the existing triage queue automatically.

### 3. New edge function `freescout-health` (GET, admin-only)

- Returns `{ configured: boolean, reachable: boolean, mailboxId, latencyMs, reason? }` by calling `freescoutFetch({ path: "/api/mailboxes" })` with a 3s timeout.
- Wired into `HelpDeskTab` as a top banner: green "Help desk is connected" / red "Help desk is offline — Freescout config invalid (https:// required)" with a "Re-test" button.
- The banner is the durable replacement for digging through edge logs.

### 4. Client-side fail-fast in `GetHelpPage`

- `useTickets`: add `retry: 1`, `staleTime: 30_000` (already), and a 5s `AbortController` on the invoke; on error or `unavailable: true`, render an empty state with the "Help desk is reconnecting — try again in a minute" card and a "Retry" button. **No spinner past 5s, ever.**
- `NewTicketDialog`: on 503 / `unavailable`, surface the specific reason from the response (`"Help desk is offline. An admin has been notified."`) instead of generic "Could not create your ticket."
- Always-available fallback: show `mailto:info@techfleet.network` as a secondary action when the help desk is unavailable, so users are never stranded.

### 5. Auto-triage signal

- The new `code: "config_invalid"` log already routes into `agent_fix_queue` via the existing triage classifier. Mark it severity `error` so admins get the standard 5-minute critical push notification.

### 6. BDD scenarios (added to `bdd_scenarios`)

- `HELP-DESK-001` Given `FREESCOUT_API_URL` is `http://...`, when a member opens Get Help, then [UI] the empty state renders in <5s with a Retry button, [DB] one `agent_fix_queue` row with code=`config_invalid` exists, [Code] `freescout-proxy` returns 200 `{items:[],unavailable:true}` for `listMine`.
- `HELP-DESK-002` Given config is invalid, when a member submits a new ticket, then [UI] toast reads "Help desk is offline. An admin has been notified." and the mailto fallback is shown, [Code] `freescout-proxy` returns 503 for `action:create`.
- `HELP-DESK-003` Given config is valid, when an admin opens System Health → Help Desk, then [UI] banner shows green with latency in ms, [Code] `freescout-health` returns `{configured:true,reachable:true}`.
- `HELP-DESK-004` Given config becomes invalid mid-session, when the banner "Re-test" is clicked, then [UI] banner flips to red with the exact reason, [DB] `system_health_events` records the transition.

### 7. Memory + runbook

- Add `mem://features/get-help-resilience` summarising the lazy-config pattern + UI fallback contract.
- Add `docs/runbooks/freescout-config-recovery.md` with the exact secret format (`https://help.techfleet.network` — no trailing slash, no quotes) and the "Re-test" loop.

### 8. Fix the actual secret value

After the code ships, prompt the user via `update_secret(["FREESCOUT_API_URL"])` so they can paste the correct `https://...` URL. The code changes above mean that even if they paste a bad value again, the page degrades gracefully and admins are alerted — instead of bricking.

## Files touched

- `supabase/functions/_shared/freescout.ts` — refactor to lazy config + typed errors
- `supabase/functions/freescout-proxy/index.ts` — 503 envelope + structured logs
- `supabase/functions/freescout-health/index.ts` — new admin-only health probe
- `src/pages/community/GetHelpPage.tsx` — timeout, fallback UI, mailto
- `src/components/system-health/HelpDeskTab.tsx` — health banner + Re-test button
- `src/services/system-health.service.ts` — `freescoutHealth()` wrapper
- `docs/runbooks/freescout-config-recovery.md` — new
- `mem://features/get-help-resilience` — new
- BDD scenario inserts via `supabase--insert`

## Risk / rollback

- Zero schema change. New edge function is additive.
- Lazy-config refactor is strictly more permissive than the current throw — if anything misbehaves, the worst case is the function returning a 503 envelope (today it returns nothing).
- Feature-flag-free; rollback = redeploy the previous function bundle.

## Out of scope

- No change to Freescout webhook verification, HMAC, or rate-limit logic.
- No UI redesign of Get Help beyond the offline state.
- No migration to a different help-desk provider.
