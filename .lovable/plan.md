# Permanent fix: triage errors from the last 3 days

Two distinct fingerprints account for every open `agent_fix_queue` row in the last 3 days:

| # | Fingerprint | Count | Source |
|---|---|---|---|
| 1 | `supabase.rpc(...).catch is not a function` | 16 | `process-email-queue` post-send path |
| 2 | `Duplicate enqueue reconciled — original sent at …` | 15 | `audit_email_send_log` trigger |

Issue 2 is a downstream symptom of Issue 1, but it also needs its own guard so future regressions don't flood triage.

---

## Issue 1 — Stale `.catch` TypeError in `process-email-queue`

### Root cause

Forensic trace for one message (`xzhao489@gatech.edu`, recovery, 2026-06-05 17:53):

```text
17:53:04.283  pending   (auth-email-hook enqueued)
17:53:08.355  sent      (process-email-queue → sendLovableEmail success)
17:53:08.407  failed    "supabase.rpc(...).catch is not a function"   ← +52ms
17:53:42.744  sent      "Duplicate enqueue reconciled — original sent at 17:53:08.355"
```

- The exception fires **after** `sendLovableEmail` succeeds and the `sent` row is written (line 501 of `supabase/functions/process-email-queue/index.ts`).
- Current source no longer contains `supabase.rpc(...).catch(...)`; it uses the `safeRpc(...)` helper with `try/catch`. The runtime error therefore comes from a **stale deployed bundle** of `process-email-queue` — the helper edit shipped in source but the function image was not re-deployed.
- Because the exception is thrown before `delete_email` (line 512), the pgmq message is never deleted. ~30s later the visibility timeout expires, the next worker tick re-reads it, the duplicate-send guard at line 357 triggers, and a reconciliation row is written — which is Issue 2.

### Fix

1. **Force redeploy** `process-email-queue` via `supabase--deploy_edge_functions` so the current `safeRpc`-based code is live. This alone removes the recurring TypeError.
2. **Harden the catch block at line 531** so a post-send exception cannot:
   - Write a spurious `failed` row when a `sent` row was already written in the same iteration. Track a local `sentInIteration` boolean; if true, downgrade the catch to a warning log + audit `edge_function_error` event only, **no `email_send_log` insert**.
   - Skip the queue cleanup. Move the `delete_email` call into a `finally`-style block that always runs after a successful `sent` write, so a downstream RPC exception cannot strand the message in the queue.
3. **Audit signal**: emit a single `edge_function_error` audit row when this path trips, so we still get triage signal without polluting `email_send_log` or producing reconciliation rows.

### Files

- `supabase/functions/process-email-queue/index.ts` — restructure the try/catch around lines 452–650 per (2) and (3).
- No DB schema change needed for Issue 1.

---

## Issue 2 — Reconciliation rows surfacing in triage as `error`

### Root cause

`public.audit_email_send_log()` marks an `email_send_log` row benign only when `status IN ('reconciled','rate_limited','frequency_capped','suppressed')`. Reconciliation rows written by the duplicate guard (line 368) use `status='sent'` with `error_message` starting with `Duplicate enqueue reconciled —`. The trigger therefore emits `email_sent` with the error_message attached, and `discover_audit_fingerprints` (which scans `error_message`) lifts it into `agent_fix_queue` as `severity=error`.

### Fix (single migration)

Update `public.audit_email_send_log()` so a row is also treated as benign when `NEW.error_message LIKE 'Duplicate enqueue reconciled%%'`, regardless of status. Apply the same `severity:info` + `note:` field move as the existing benign branch, and pass `NULL` for `p_error_message`. This permanently keeps reconciliation rows out of triage even if Issue 1 ever regresses.

Plus a one-time housekeeping update to resolve the 15 already-queued reconciliation rows + the 16 stale TypeError rows in `agent_fix_queue`:

```sql
UPDATE public.agent_fix_queue
SET status = 'resolved',
    resolved_at = now(),
    dismissed_reason = 'fixed_by_permanent_redeploy_and_trigger_guard_2026_06_05'
WHERE status = 'pending'
  AND (error_message LIKE 'Duplicate enqueue reconciled%%'
       OR error_message = 'supabase.rpc(...).catch is not a function');
```

### Files

- New migration: update `public.audit_email_send_log()` + housekeeping UPDATE above.

---

## Verification

After deploy + migration:

1. `SELECT COUNT(*) FROM email_send_log WHERE error_message = 'supabase.rpc(...).catch is not a function' AND created_at > now() - interval '10 min'` → expect `0` after first cron tick.
2. `SELECT msg_id, vt FROM pgmq.q_auth_emails ORDER BY enqueued_at DESC LIMIT 5` → no messages stuck past their VT.
3. `SELECT COUNT(*) FROM agent_fix_queue WHERE status = 'pending' AND last_seen_at > now() - interval '1 hour'` → 0 new rows from either fingerprint.
4. Trigger a real password reset → exactly one `sent` row, no `failed` row, no reconciliation row.

---

## Out of scope

- Password reset flow (already permanently fixed in prior turn).
- Email lane prioritization, workspace token bucket, bulk caps — all functioning correctly.
- The `support-monthly-report` `.catch(() => null)` pattern — that one is on a `Promise` so it's safe.
