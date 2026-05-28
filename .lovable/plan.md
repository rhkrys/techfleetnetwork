## Triage finding

The AI hypothesis ("add retry with exponential backoff") is **already implemented** in `supabase/functions/process-email-queue/index.ts`. On a 429 the dispatcher:

1. Logs `email_send_log.status='rate_limited'`
2. Reads `Retry-After` (defaults to 60s when missing — Resend's "High demand" payload has no header)
3. Sets `email_send_state.retry_after_until = now + N seconds`
4. Stops the batch; pgmq visibility-timeout returns the unsent messages; next cron tick resumes after the cooldown.

So this 429 is **not a bug** — the safety net caught it. But three real weaknesses surfaced:

| # | Weakness | Impact |
|---|---|---|
| A | **Single global cooldown** halts both `auth_emails` and `transactional_emails` queues on any 429. An OTP magic-link can sit unsent for 60s because a `project-blast` tripped the limit. Auth emails have a 15-min TTL — repeated hits = DLQ. | High — affects sign-in |
| B | **Fixed 60s fallback** when Resend omits `Retry-After`. Repeated bursts get the same 60s window and re-trip immediately, producing a flapping pattern. No exponential growth, no reset-on-success. | Medium |
| C | **No admin signal** when `retry_after_until` fires. System Health Email tab and Triage don't surface "queue paused, cooldown active" so the only way to notice is the user-pasted error. | Medium |

## Plan (small, surgical, all in dispatcher + state table)

1. **Per-queue cooldown** — extend `email_send_state` with `auth_retry_after_until` + `transactional_retry_after_until` (keep legacy column as fallback). Dispatcher reads the right one per queue inside the `for (const queue of [...])` loop. A 429 on `transactional_emails` no longer freezes `auth_emails`. (Migration adds two timestamp columns + drops one default.)

2. **Exponential backoff with success-reset** — add `consecutive_rate_limits_<queue>` int columns. On 429: `delay = min(60 * 2^n, 900) seconds`. On any successful send in that queue: reset counter to 0. Uses existing `getRetryAfterSeconds()` when Resend sends one; only escalates when it doesn't.

3. **Adaptive send delay** — when `consecutive_rate_limits > 0` for the active queue, multiply `send_delay_ms` by `2^n` for the current batch only (no DB write). Smooths the next pass instead of slamming back into the limit.

4. **Admin visibility** — when a cooldown is set or extended:
   - Insert a row into `agent_fix_queue` with `severity='warn'`, fingerprint `email_queue.rate_limited.<queue>`, dedupe key on the hour (matches existing Triage Noise Suppression pattern).
   - Add a "Queue cooldown" pill to the System Health → Email tab (reads `email_send_state.*retry_after_until`).
   - Daily Triage Digest gets a "Rate-limit cooldowns: N (auth: x, transactional: y)" line.

5. **BDD scenarios** in `bdd_scenarios`: `EMAIL-RL-001` (transactional 429 does not pause auth), `EMAIL-RL-002` (consecutive 429s grow exponentially), `EMAIL-RL-003` (success resets counter), `EMAIL-RL-004` (admin sees cooldown in System Health), each with tri-layer [UI]/[DB]/[Code] assertions.

## Out of scope (do not do)

- ❌ Adding `sendEmailWithRetry()` inside `send-transactional-email`, `send-project-blast`, `send-announcement-email`, etc. The queue is the single retry point; per-call retries would double-retry and double-log.
- ❌ Lowering `bulk_hourly_cap` — root cause is burst shape, not volume. The cap already protects sender reputation.
- ❌ Switching providers / changing throughput defaults.

## Verification

1. Force a 429 via test fixture in `process-email-queue` → only the affected queue's `retry_after_until` is set; the other queue keeps draining (verified via `email_send_log` rows in the cooldown window).
2. Two consecutive 429s 30s apart → second cooldown is 120s, third is 240s, capped at 900s.
3. One success after a 429 → counter resets to 0.
4. `agent_fix_queue` shows a single deduped warn row per hour per queue; System Health Email tab shows the live cooldown badge.

## Files touched

- `supabase/migrations/<ts>_email_queue_per_lane_backoff.sql` — 4 new columns on `email_send_state`, backfill defaults.
- `supabase/functions/process-email-queue/index.ts` — split cooldown read/write per queue, exponential math, success-reset, agent_fix_queue insert.
- `src/pages/admin/SystemHealth/EmailTab.tsx` (or current path) — cooldown badge.
- `supabase/functions/triage-daily-digest/index.ts` — one-line summary addition.
- `bdd_scenarios` rows: EMAIL-RL-001..004.
