# Why blast emails are stuck "pending"

## Root cause (from live data + code)

At **13:31:50 UTC** the bulk lane sent one announcement that received a single 429 from the email provider:

```
rate_limit:workspace:email_send  → "High demand! Please try again in a moment."
```

`process-email-queue` (lines 619‑633) then set `email_send_state.bulk_retry_after_until` to **14:29:01 UTC** — a **~58‑minute cooldown** — because it honors the provider's `Retry-After` header verbatim (`Math.max(providerSecs, expSecs)`). Confirmed in DB:

- `bulk_consecutive_rate_limits = 1`
- `bulk_retry_after_until = 2026‑06‑09 14:29:01+00`
- 112 `pending` rows in `email_send_log` over the last 2 hours
- Logs every 5s: `Skipping queue (cooldown active) { queue: "bulk_emails", until: "...14:29:01..." }`

So a **single** workspace‑wide 429 froze the entire bulk lane for nearly an hour, even though:

1. The workspace token bucket (`consume_workspace_email_token`) already halved itself on the 429 and is structurally pacing every send below the provider ceiling.
2. The 429 is workspace‑scoped (shared with auth + transactional), not bulk‑specific — the provider's giant `Retry-After` is meant for the bucket as a whole, not as a "stop sending bulk for an hour" instruction.
3. Auth and transactional lanes have their own per‑queue cooldown rows and were unaffected — exactly as designed — but the bulk lane is doing nothing while the bucket is already gating safely.

## Permanent fix

Three coordinated changes so this never recurs:

### 1. Cap per‑lane cooldown for workspace‑quota 429s (`process-email-queue/index.ts`)

When `isWorkspaceQuota === true`, the workspace token bucket is the primary throttle. The per‑lane cooldown is only a "second line of defense" (per the existing comment at line 469) and should be **short**. Change the cooldown calc so workspace‑quota 429s use a bounded backoff:

```ts
const isWorkspaceQuota = /rate_limit:workspace:email_send/i.test(errorMsg)
// Per-lane cooldown: workspace-quota 429s use a short cap because the
// token bucket has already halved and gates every subsequent send.
// True per-lane 429s (provider lane-specific) honor full Retry-After.
const baseCap = isWorkspaceQuota ? 120 : 900           // 2 min vs 15 min
const expBase = isWorkspaceQuota ? 30  : 60
const expSecs = Math.min(expBase * Math.pow(2, nextCount - 1), baseCap)
const providerSecs = isWorkspaceQuota
  ? Math.min(getRetryAfterSeconds(error), baseCap)     // ignore giant header
  : getRetryAfterSeconds(error)
const retryAfterSecs = Math.max(providerSecs, expSecs)
```

Result for the same incident: 30s lane cooldown instead of 58 min. Bucket continues to enforce real pacing on every tick.

### 2. Reset stale `bulk_consecutive_rate_limits` on idle ticks

Today the counter only resets on a successful send (line 547‑557). If a 429 hits and then traffic goes quiet, the counter stays at N and the next 429 doubles. Add a one‑line reset when a lane has zero queued messages AND cooldown has fully expired (idle = no contention).

### 3. Admin "Resume bulk lane now" button + audit row (System Health → Email tab)

Add an admin‑only RPC `clear_email_lane_cooldown(lane text)` (SECURITY DEFINER, `has_role(auth.uid(),'admin')`) that:

- Clears `<lane>_retry_after_until` and `<lane>_consecutive_rate_limits`.
- Writes `record_event(sink:='audit_log', kind:='email_lane_cooldown_cleared', severity:='info', payload:=jsonb_build_object('lane', lane, 'cleared_by', auth.uid()))` so we have a tamper‑evident trail.

Surface a "Resume now" button next to the existing bulk‑lane status in the System Health Email tab (visible only while a cooldown is active). One click → 200 OK → next cron tick (≤5s) drains the queue.

### 4. Immediately unfreeze the current incident

In the same migration, run:

```sql
UPDATE email_send_state
   SET bulk_retry_after_until = NULL,
       bulk_consecutive_rate_limits = 0,
       updated_at = now()
 WHERE id = 1 AND bulk_retry_after_until > now();
```

so the 112 pending blast rows start sending within 5s of deploy.

## BDD coverage to add

`EMAIL-RL-015` workspace‑quota 429 → lane cooldown ≤ 120s regardless of provider Retry-After.
`EMAIL-RL-016` idle tick with expired cooldown resets `*_consecutive_rate_limits` to 0.
`EMAIL-RL-017` admin can clear lane cooldown via RPC; non‑admins receive permission error; audit_log captures the action.

## What I will NOT change

- Auth & transactional cooldown logic (already isolated, working as designed).
- Token bucket math (already self‑healing — halves on 429, +10% per 500 wins).
- Bulk hourly cap, batch size, pacing knobs.

## Files touched (build phase)

- `supabase/functions/process-email-queue/index.ts` — bounded workspace‑quota cooldown + idle counter reset.
- `supabase/migrations/<ts>_email_lane_cooldown_controls.sql` — `clear_email_lane_cooldown` RPC, grants, immediate unfreeze.
- `src/pages/admin/SystemHealth/EmailTab.tsx` (or equivalent) — "Resume now" button.
- `supabase/seed/bdd/email-rate-limit.sql` — 3 new scenarios.
- Memory update: extend `mem://features/email-queue-per-lane-cooldown` with the workspace‑quota cap rule.
