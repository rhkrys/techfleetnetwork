
## Why isabelle's email shows as pending

The community-agreement email to `isabelle01092003@gmail.com` was **actually sent successfully** at 17:43:47 on 2026-06-01. But the dashboard shows it as `pending` because of a real bug in the append-only log:

```
17:43:44  pending  ← first enqueue
17:43:47  sent     ← worker delivered it
17:43:52  pending  ← second enqueue (duplicate) inserted ANOTHER pending row
```

The second enqueue (a duplicate submit/retry from the client) wrote a fresh `pending` row, then the worker hit the `alreadySent` guard (`process-email-queue/index.ts` line 318-339), deleted the duplicate from the queue, and **never wrote a terminal status row**. The "latest row per message_id" dedup view therefore shows `pending` forever even though the email was delivered ~5s earlier.

Checked the whole system: only **4** distinct emails are currently visible as stuck, all 4 have an earlier `sent` row (same dup-skip pattern), and **0 are truly orphaned** (no queue entry, no terminal row). The retry engine (pgmq VT + MAX_RETRIES + DLQ) is working — what's missing is (a) preventing duplicate pending rows at the source, (b) writing a terminal row when the worker dedup-skips, and (c) a safety net that reconciles anything that ever slips through.

## The fix (3 layers + backfill)

### Layer 1 — Prevent duplicate `pending` rows at enqueue time
**File:** `supabase/functions/_shared/transactional-email.ts` (around line 440)

Before inserting the `pending` log row and calling `enqueue_email`, check whether a row with the same `messageId` already exists with status `sent`, `failed`, `dlq`, or recent `pending` (<5 min). If so, return early with `{ok: true, deduped: true}` and do NOT enqueue. This is what the client-side `useIdempotentMutation` debounce is supposed to catch, but a server-side guard makes it bulletproof.

### Layer 2 — Always write a terminal row in the worker dedup-skip path
**File:** `supabase/functions/process-email-queue/index.ts` (lines 316-340)

When `alreadySent` is true, insert a reconciliation row before deleting the duplicate queue msg:
```
status: 'sent'
error_message: 'Duplicate enqueue reconciled — original sent at <ts>'
```
This guarantees the latest-row-per-message_id view is always terminal.

### Layer 3 — Self-healing reconciler cron (the real "never pending again" guarantee)
**New edge function:** `supabase/functions/reconcile-stuck-emails/index.ts`
**Cron:** every 5 minutes (pg_cron)

For every `email_send_log` row whose **latest** status per `message_id` is `pending` and `created_at < now() - interval '10 minutes'`:

| Condition | Action |
|---|---|
| message_id still in `pgmq.q_*` queue | Leave alone — worker will get to it |
| message_id NOT in queue AND a later `sent`/`failed`/`dlq` exists | Insert reconciliation row (`sent` or `dlq` matching reality) — dashboard becomes terminal |
| message_id NOT in queue AND no terminal row exists AND queued_at within TTL | **Re-enqueue** automatically with the original payload reconstructed from the pending row + template registry |
| message_id NOT in queue AND past TTL | Insert `dlq` row with reason `Lost before send — reconciler timeout` + push severity=`error` to `agent_fix_queue` |

Pure server-side, no human prompt ever needed. Emits per-run counters (`reconciled_terminal`, `requeued`, `dlq_lost`) to `ops_events` for the System Health dashboard.

### Layer 4 — Backfill the 4 currently-stuck rows

One-shot SQL migration: for each of the 4 visible stuck pendings (all have earlier `sent` rows), insert a `sent` reconciliation row dated `now()` so the dashboard immediately clears.

### Layer 5 — System Health visibility
**File:** `src/pages/SystemHealthPage.tsx` (Email tab) + `system-health.service.ts`

Add a "Stuck pending (>10 min)" stat card next to the existing Sent / Failed / Suppressed cards, plus a small "Reconciler last run" indicator showing `reconciled_terminal` / `requeued` / `dlq_lost` counts from the latest `ops_events` row. If `stuck_pending > 0` between reconciler runs, the card shows amber — but the next 5-min cron clears it automatically.

## Out of scope
- Changing the email-queue retry budget, TTLs, or rate-limit logic (already correct).
- Changing the append-only nature of `email_send_log` (compliance requirement).
- Re-enabling PWA, touching auth, or anything in the wedge-recovery path.

## Files touched
- `supabase/functions/_shared/transactional-email.ts` (server-side dedup guard)
- `supabase/functions/process-email-queue/index.ts` (terminal row on dedup-skip)
- `supabase/functions/reconcile-stuck-emails/index.ts` **(new)**
- `supabase/config.toml` (pin new function)
- New migration: backfill 4 rows + create pg_cron for reconciler + grants
- `src/pages/SystemHealthPage.tsx` + `src/services/system-health.service.ts` (Stuck-pending card)
- BDD: new scenarios `EMAIL-RECONCILE-001..006`
