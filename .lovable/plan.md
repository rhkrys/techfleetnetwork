## What's actually in triage right now

29 pending error-fingerprints (32 occurrences). Real distribution:

| Bucket | Pending fingerprints | Occurrences | Root cause |
|---|---|---|---|
| A. `journey-completed: Failed to count progress` | **19** | 21 | Each per-user × per-phase × per-task-list is a unique fingerprint (`source = query.journey-completed.<userId>.<phase>.<task-ids…>`). One transient RLS/PostgREST blip on a busy day = 19 new "incidents" that all share one root cause. |
| B. `SerializationError: Non-Error thrown: {"message":""}` | 5 | 6 | Empty-payload React Query throw; opaque, non-actionable, already a known-noise class. |
| C. `Failed to load project openings` / `quest paths` / `quest selections` | 3 | 3 | Same shape as A — `source` carries a user/quest UUID so every user is a new fingerprint. |
| D. `get_dashboard_overview(p_user_id) not in schema cache` | 1 | 1 | Stale cached bundle calling old RPC signature; backcompat shim is already deployed (per memory `RPC Signature Backcompat`). Residue, not an active bug. |
| E. one-off `Failed to count progress` from unhandledrejection | 1 | 3 | Same as A, different reporter entrypoint. |

**Common pattern:** the queue is full of *the same bug seen by N different users*, not N different bugs. The current fingerprint function is `${source}::${msg.slice(0,200)}` and `source` embeds UUIDs + dynamic lists, so dedupe never fires.

## The 4 permanent fixes

### Fix 1 — Normalize fingerprint sources (kills buckets A, C, E)

In `src/services/error-reporter.service.ts` `fingerprint(msg, source)`:

- Strip UUIDs from `source` → replace `/[0-9a-f]{8}-[0-9a-f]{4}-…/i` with `:id`.
- Collapse trailing dot-separated id-lists (length > 1 comma-separated tokens or > 3 dot tokens of slugs) to `:list`.
- Same for the message body before the slice.

Result: 19 pending journey fingerprints collapse to **1** (`query.journey-completed:id.first_steps:list::Failed to count progress`). Future per-user occurrences increment `occurrence_count` on that single row instead of opening 19 new triage items. New unit tests in `src/test/services/error-reporter.fingerprint.test.ts` lock the normalization. DB-side discover_audit_fingerprints already has its own grouping; no DB change needed.

### Fix 2 — Graceful degrade on `getCompletedCount` (root-causes bucket A)

In `src/services/journey.service.ts`:

- Wrap the count query with `isTransientError` check (PostgREST 5xx, network, abort) → return `0` silently, no throw.
- On **structural** error (RLS denial, 404 table, code bug) → still throw, but caller is hardened to render the phase with `?` count rather than crashing the dashboard tile.
- Caller (`useJourneyProgress`) gets `placeholderData: previous` so a single blip is invisible to the member.

Net effect: even if Fix 1 weren't in place, a backend hiccup during journey load no longer opens any triage row at all; only a true regression does.

### Fix 3 — Drop opaque `SerializationError: Non-Error thrown` (kills bucket B)

In `src/services/error-reporter.service.ts` `isReporterNoise()` (the same gate that already filters opaque `Script error.`), add a pattern: messages matching `/^SerializationError: Non-Error thrown:\s*\{?"?message"?:\s*""?\}?$/` are dropped at the reporter entrypoint AND added to `known_issue_catalog` as a 30-day DB backstop, matching the existing opaque-error pattern from memory `Triage Noise Suppression`.

### Fix 4 — Sweep stale RPC residue (kills bucket D and future cousins)

One-time migration calls the existing `resolve_stale_fingerprints_on_deploy(pattern, reason)` RPC (already in memory `RPC Signature Backcompat`) with patterns:
- `%get_dashboard_overview(p_user_id)%` → reason `shim_deployed_2026-06-14`
- `%Could not find the function public.%in the schema cache%` older than 7 days → reason `stale_bundle_post_shim`

Also wire this into the deploy-watcher hook so any future RPC-rename leaves no triage debris after a deploy.

## What this changes (and what it doesn't)

**Changes (code-only, no schema, no UX):**
- `src/services/error-reporter.service.ts` — normalize fingerprints, add Non-Error-thrown to noise gate.
- `src/services/journey.service.ts` — graceful-degrade on transient count failures.
- `src/hooks/use-journey-progress.ts` — `placeholderData: previous`.
- `src/lib/known-issues.ts` (or equivalent) — add the SerializationError pattern.
- One SQL migration: a single `SELECT resolve_stale_fingerprints_on_deploy(...)` cleanup call (no DDL).

**Does not change:** any table, RLS policy, edge function, member-facing UI, auth path, or memory rules. Stays inside the Triage Noise Suppression and Idempotency contracts already in memory.

## Receipts you'll get

1. Unit tests for fingerprint normalization (5 cases: UUID, task-id list, mixed, no-op, message-only).
2. Unit test that `getCompletedCount` returns `0` on transient and re-throws on structural.
3. Before/after count from `agent_fix_queue` showing pending dropped from 29 → ≤ 3 (anything not in the 4 buckets above stays — those are real and need attention individually).
4. New BDD: `TRIAGE-NOISE-013..016` covering the four fixes with tri-layer asserts.

## Why this finally clears triage for good

Today every user who sees the same blip opens a new row. After these 4 fixes the queue shows **one row per real defect**, transient blips never reach the queue, opaque payloads are dropped at the door, and stale-bundle residue is auto-swept on each deploy. The queue stops being a noise generator and starts being an actual to-do list.