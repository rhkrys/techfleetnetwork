# Fix: UGC translations Realtime leak

## Root cause
`ugc_translations` is in `supabase_realtime` publication. Realtime applies the table's RLS SELECT policy to each subscriber — the public-read policy on `qa_passed`/`approved` rows means any anon (or auth'd) subscriber to that channel receives **every** translated UGC row platform-wide. `entity_table` + `entity_id` make those rows correlatable back to specific records.

## Approach
Replace table-level `postgres_changes` broadcasts with **per-entity Realtime Broadcast topics** populated by a DB trigger. Each subscriber only receives payloads for the exact `(entity_table, entity_id)` they're rendering — no global firehose. Keep the HTTP cache-read RLS unchanged so first-paint behavior is identical for anon users (no UX regression).

## Steps

1. **Migration**
   - `AFTER INSERT OR UPDATE` trigger on `public.ugc_translations`: when `NEW.status IN ('qa_passed','approved')`, call `realtime.send(payload jsonb, 'ugc_translation', 'ugc:' || NEW.entity_table || ':' || NEW.entity_id, private := false)`. Payload contains only `column_name`, `target_locale`, `source_hash`, `translated_text` (no cross-entity identifiers beyond what the subscriber already knows).
   - `ALTER PUBLICATION supabase_realtime DROP TABLE public.ugc_translations;`
   - Add `realtime.messages` RLS: `SELECT` allowed when `topic LIKE 'ugc:%'` for both `anon` and `authenticated` (UGC is intentionally public read; per-topic scoping prevents fan-out).

2. **Client (`src/hooks/useUgcTranslation.ts`)**
   - Replace the `.on('postgres_changes', { table: 'ugc_translations', filter: 'entity_id=eq…' })` subscription with `.on('broadcast', { event: 'ugc_translation' }, …)` on channel `ugc:{entityTable}:{entityId}`.
   - Match on `column_name + target_locale + source_hash` exactly as today.
   - HTTP cache-read path in step 1 of the hook is unchanged.

3. **Verification**
   - Manual: open two browser tabs on different projects in a non-English locale; confirm tab A never receives tab B's translation broadcast.
   - Linter + scan re-run to confirm finding closed.
   - BDD: add `I18N-UGC-015` — "anon Realtime subscriber on entity X never receives translations for entity Y".

## What does NOT change
- `ugc_translations` RLS for SELECT (HTTP reads) stays public for `qa_passed`/`approved` — required for first-paint cache hits.
- `useUgcTranslation` public API, fallback behavior, and "Translating…" UX.
- Admin tabs, backfill RPCs, prewarm worker.

## Files touched
- `supabase/migrations/<new>.sql` — trigger, drop from publication, realtime.messages policy.
- `src/hooks/useUgcTranslation.ts` — swap subscription mechanism.
- `mem://features/i18n-ugc-translation` — note the broadcast-topic change.
