## Goal

Reduce how often the self-healing Lovable Email 429 surfaces as triage noise. Two surgical changes, no behavior regression.

## Changes

1. **Lower burst throughput** — update `email_send_state` row id=1:
   - `batch_size = 5` (from 10)
   - `send_delay_ms = 400` (from 200)
   - Effective throughput drops from ~120/min to ~75/min, staying under the workspace email rate limit during Project Blast / announcement bursts.

2. **Suppress the expected 429 fingerprint in triage** — add `email_queue.rate_limited.*` fingerprints (auth + transactional) to the `known_issue_catalog` as `expected_self_healing`, matching the existing Triage Noise Suppression pattern. The dispatcher still records the cooldown in `email_send_state` and the System Health Email tab still shows the cooldown badge — only the duplicate `agent_fix_queue` warn row is suppressed.

## Out of scope

- No dispatcher code changes (backoff already correct per EMAIL-RL-001..004).
- No provider switch, no cap reduction beyond throughput smoothing.
- System Health visibility unchanged.

## Verification

- `SELECT batch_size, send_delay_ms FROM email_send_state WHERE id = 1;` returns 5 / 400.
- `SELECT fingerprint FROM known_issue_catalog WHERE fingerprint LIKE 'email_queue.rate_limited%';` returns both lanes.
- Next bursty send: cooldown still set, badge still shows, no new `agent_fix_queue` row for that fingerprint.

## Files touched

- `supabase/migrations/<ts>_email_throttle_and_429_suppression.sql` — UPDATE on `email_send_state` + INSERTs into `known_issue_catalog`.
