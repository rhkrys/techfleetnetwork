---
name: Get Help scale contract
description: Layered cache + in-isolate concurrency cap + pgmq webhook fan-out keep p95 flat at 10k members
type: feature
---

The Freescout integration is bounded on three independent dimensions so Pikapod's Freescout is never the bottleneck under load:

**1. Layered cache (~80% upstream cut)**
- Client (React Query): `staleTime: 60_000`, `gcTime: 300_000`, `refetchOnWindowFocus: false`, `refetchOnMount: false`. Two opens of Get Help in a session → zero upstream calls the second time.
- Edge (in-isolate LRU, 500 entries, `supabase/functions/_shared/freescoutCache.ts`): keyed by `sha256(userId|action|JSON(query))`. TTL: `listMine` 30s, `listAll` 30s, `get` 10s. Mutations (`create`, `reply`, `close`, `reopen`, `assign`, `setPrivate`) call `invalidateUser` or `invalidateAll`.
- Admin tab fan-out collapse: 3 admins × 2 tabs × 1 isolate × 30s = 1 upstream fetch.

**2. In-isolate concurrency semaphore**
- `MAX_CONCURRENT = 8`, `MAX_WAIT_MS = 2000` in `_shared/freescout.ts`. Waiters queue then fail fast with `FreescoutError(503)`. Not a distributed rate limiter (workspace policy forbids those) — pure upstream protection against thundering herds.
- Combined with the existing circuit breaker (5 fails → 30s open), Freescout cannot be DoS-ed from a single warm isolate.

**3. Webhook async fan-out (the real scaling axis)**
- `freescout-webhook` is the hot path: HMAC verify → idempotency insert on `support_webhook_events.event_id` (PK + no-update trigger) → enqueue to `q_freescout_events` via `freescout_enqueue_event` RPC → return 200. Target <100ms.
- `process-freescout-events` cron-poked every 15s, drains via `freescout_dequeue_events`, applies pointer/event/notification writes that used to run inline. Failures past 3 reads go to `q_freescout_events_dlq` via `freescout_send_to_dlq`.

To change cache TTL or concurrency: edit the constants in `_shared/freescout.ts` / `_shared/freescoutCache.ts` directly — code is the source of truth.

BDD: HELP-DESK-020 (cache hit), HELP-DESK-021 (admin fan-out collapse), HELP-DESK-022 (webhook idempotency), HELP-DESK-023 (webhook <100ms).
