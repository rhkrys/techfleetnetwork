Permanent fix plan:

1. Add a dedicated bulk email lane
- Create `pgmq.bulk_emails` so announcements, project blasts, Fleety coach digests, and triage digests can never block authentication or transactional emails again.
- Keep auth confirmations/password resets on `auth_emails` with highest priority.
- Keep individual transactional emails on `transactional_emails` with second priority.

2. Update email routing at the source
- Change shared email enqueue logic so bulk templates are routed to `bulk_emails` before they enter the queue.
- Preserve existing idempotency, logs, retry metadata, and unsubscribe behavior.

3. Update the queue worker permanently
- Drain queues in fixed priority order: `auth_emails` → `transactional_emails` → `bulk_emails`.
- Give each lane its own cooldown, retry-after handling, batch size, and send delay.
- Apply stricter pacing and hourly caps only to bulk email.
- Ensure a 429 in bulk cannot pause auth or transactional lanes.

4. Add operational visibility
- Log lane-specific rate-limit freezes.
- Create/route a System Health triage item when auth or transactional delivery is frozen longer than the allowed threshold.
- Keep DLQ checks per lane.

5. Add BDD and regression coverage
- Add database-backed BDD scenarios proving lane isolation across UI, DB, and code/API layers.
- Add tests that simulate a bulk 429 and verify signup confirmation/password reset still drain.
- Add tests that verify transactional emails continue while bulk is cooling down.

6. Save the working rule so this does not repeat
- Add a durable project/user memory rule: production incidents must receive a root-cause permanent fix, not only cooldown resets or other temporary relief, unless you explicitly ask for emergency mitigation only.