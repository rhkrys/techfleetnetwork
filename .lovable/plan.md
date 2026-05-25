## Problem

`process-email-queue` correctly enforces the 24h per-recipient bulk-email cap (project-blast / fleety-coach-digest), but every cap-hit also calls `upsert_fix_queue_entry` with fingerprint `email.frequency_capped.<label>`. That surfaces a normal, healthy guardrail as a triage item — exactly the noise the user is seeing.

The cap-hit is already captured two cleaner ways:
- `email_send_log` row with `status = 'frequency_capped'` (durable audit).
- System Health → Email tab counts those rows in the deliverability card (`EmailDeliverabilityCard.tsx` line 67).

So the triage upsert is redundant and miscategorised.

## Fix

1. **`supabase/functions/process-email-queue/index.ts`** — delete the `upsert_fix_queue_entry` block (lines ~319–327). The `email_send_log` insert at line 311 stays as the source of truth; the cap behavior is unchanged.

2. **Belt-and-suspenders catalog entry** — insert one `known_issue_catalog` row so any legacy caller or future regression is auto-suppressed at the queue gate:
   - `match_kind = 'fingerprint'`
   - `pattern = 'email.frequency_capped.'` won't help with fingerprint kind, so use `match_kind = 'substring'`, `pattern = 'email.frequency_capped.'`, `event_type_filter = 'email_frequency_capped'`, reason = "Intended frequency-cap guardrail; tracked via email_send_log.status='frequency_capped'."

3. **Clean current queue** — auto-resolve all open `agent_fix_queue` rows where `fingerprint LIKE 'email.frequency_capped.%'`: set `status='resolved'`, `resolved_at=now()`, `dismissed_reason='Reclassified as info — guardrail working as designed'`.

4. **Redeploy** `process-email-queue`.

5. **BDD** — add `EMAIL-CAP-TRIAGE-001` to `bdd_scenarios`:
   - Given a recipient at the 24h bulk cap, When `process-email-queue` drops the email, Then
     - [UI] System Health → Email shows the frequency-capped count incrementing; System Health → Triage shows no new row for `email_frequency_capped`.
     - [DB] new `email_send_log` row with `status='frequency_capped'`; zero rows inserted into `agent_fix_queue` for fingerprint prefix `email.frequency_capped.`.
     - [Code] `process-email-queue` does not call `upsert_fix_queue_entry` for cap drops; `known_issue_catalog` row with substring `email.frequency_capped.` is active.

6. **Memory** — append a one-liner to `mem://features/triage-noise-suppression` noting frequency-cap drops are now treated as info, not triage events.

## Out of scope

- The cap behavior, window, and `bypass_frequency_cap` flag stay exactly as-is.
- DLQ replay path (`replay-dlq-emails`) and the `replay_frequency_capped` RPC stay as-is — admins can still manually replay.
- The `email_send_log` status enum stays unchanged.

## Files

**Edit**
- `supabase/functions/process-email-queue/index.ts`

**Data only (insert tool, not migration)**
- `known_issue_catalog` insert
- `agent_fix_queue` resolve sweep
- `bdd_scenarios` insert

**Redeploy**
- `process-email-queue`
