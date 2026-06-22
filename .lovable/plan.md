## Why it timed out

`/admin/activity-log` runs a **full exact COUNT** against `audit_log` before fetching the first page:

```ts
supabase.from("audit_log").select("id", { count: "exact", head: true })
```

`audit_log` is the largest, hottest write-only table in the system (every auth event, every error, every triage row). A `COUNT(*)` over the whole table — with no narrow filter — does a sequential scan that routinely exceeds the **10s client timeout** at line 44. When the count promise loses the race, the page short-circuits to the error banner *even though the page rows would have loaded fine*.

So the message is literally true: the **count** timed out, not the data.

## Fix — three layers, no UX regression

### 1. Replace exact-count with a tiered strategy (SQL + client)

Add `public.audit_log_count_fast(p_event_type text, p_from timestamptz, p_to timestamptz) returns bigint` (SECURITY DEFINER, admin-only via `has_role`).

Logic:
- If **no filters** → return `pg_class.reltuples::bigint` for `audit_log` (planner estimate, O(1)).
- If filters present AND estimated rows ≤ 50k → run exact `COUNT(*)` with the same WHERE clause.
- Else → return estimate from `EXPLAIN (FORMAT JSON)` of the filtered query (still O(1)).

Returns a single number in <50ms regardless of table size.

### 2. Decouple count from rows in `ActivityLogPage.tsx`

- Fetch **rows first** (`Promise.allSettled([rowsPromise, countPromise])` semantically).
- If count fails or times out → render rows, show `"~N events"` with a tooltip ("Estimated. Refresh to recount.") instead of the full-page error. Pagination uses `hasMore = rows.length === PAGE_SIZE`.
- Only fail the whole page if **rows** fail.
- Bump per-query timeout to 15s and wire an `AbortController` to actually cancel the underlying fetch (current `Promise.race` leaks the request).

### 3. Make `audit_log` count-friendly

- Add partial index `audit_log (event_type, created_at DESC)` to back filter+range counts.
- Confirm existing `audit_log (created_at DESC)` index — add if missing.
- `ANALYZE public.audit_log` in the migration so `reltuples` is fresh.

## Files

- `src/pages/ActivityLogPage.tsx` — call new RPC, allSettled split, AbortController, tooltip on estimated count, 15s timeout.
- `src/lib/data/with-timeout.ts` *(new, extracted from inline helper)* — reusable `withAbortableTimeout` wrapper.
- `supabase/migrations/<ts>_audit_log_count_fast.sql` — RPC + GRANT EXECUTE TO authenticated + indexes + ANALYZE.
- `src/test/pages/activity-log-count-degradation.test.tsx` *(new)* — asserts rows render when count rejects.
- `src/test/lib/with-timeout.test.ts` *(new)*.
- `public.bdd_scenarios` — `ACTIVITY-LOG-COUNT-001..004` (no filter → estimate; filter → exact; count failure → rows still render with `~N`; timeout aborts underlying request).

## Out of scope

- No change to `audit_log` retention, RLS, or write path.
- No change to Triage / System Health tabs that also read `audit_log` (separate ticket if they exhibit the same pattern).
- No change to the existing tab-switch / sessionStorage state preservation (already covered by NO-RELOAD-TAB-001).

## Receipts after build

- Migration applied; `audit_log_count_fast(null,null,null)` returns in <100ms.
- Activity Log loads with rows visible even if count RPC is killed mid-flight (forced in test).
- Old `select("id", { count: "exact", head: true })` on `audit_log` removed from the page (greppable proof).
- 4 BDD scenarios inserted; 2 vitest specs green.
