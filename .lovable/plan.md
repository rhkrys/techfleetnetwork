
## What's actually happening

The opaque cross-origin `"Script error."` row you're looking at is **not new**. The DB query confirms:

- All 4 matching rows in `agent_fix_queue` are dated **2026-06-02 16:23 UTC or earlier**, all `status='resolved'`.
- The permanent `reject_opaque_script_error` BEFORE-INSERT trigger on `audit_log` and `agent_fix_queue` was deployed at **2026-06-02 19:43 UTC**.
- **Zero new `Script error.` rows have hit either table since the trigger shipped.** The backstop works.

What you saw in the UI ("triaged less than a minute ago") is the **AI triage stamp**, not the error timestamp. Something (or someone) ran `triage-error` on an old, already-resolved opaque row, which:

1. Spent ~$0.001 of the 20-call/day AI budget on a row that's already permanently silenced.
2. Re-surfaced the row in the Triage view via the `triaged_at` sort, making it look like a live incident.
3. Convinced you the bug is back.

## Permanent fix — close the four remaining gaps

### 1. `triage-error` refuses opaque / known-issue rows server-side

In `supabase/functions/triage-error/index.ts`, after loading the `agent_fix_queue` row and before claiming the budget:

- Reject (HTTP 409 `auto_silenced`) if `row.error_message` first non-empty line matches `^(error:\s*)?script error\.?$`.
- Reject if a matching active `known_issue_catalog` entry covers the message (substring or regex, scoped to `event_type_filter` when set).
- On reject, auto-flip the row to `status='resolved'` with `dismissed_reason='[auto] silenced by known_issue_catalog at triage time'` so it disappears from the active queue, and skip the AI call entirely.

This makes the AI budget physically unreachable for any pattern the backstop already silences, regardless of how the row got into the queue historically.

### 2. Hard-purge legacy opaque rows (one-time migration)

Single migration that deletes (not just resolves) every `agent_fix_queue` row whose `error_message` first non-empty line matches the opaque regex. Mirrors the same delete on residual `audit_log` rows older than the trigger so discovery can't re-promote them. Logs the deletion count into `audit_log` (severity:info, event_type:`maintenance_cleanup`) for traceability.

### 3. CI guard against regressions

Add `scripts/ci/check-no-opaque-script-error.mjs` to the existing `quality` CI job:

- Queries `agent_fix_queue` and `audit_log` for any row matching the opaque regex created in the last 24h.
- Exits non-zero with the row IDs if any are found.

A failing build is then the canary the moment another reporter path or third-party script regresses past the filter.

### 4. Lock down the production entry script's `crossorigin` attribute

Confirm Vite preserves `crossorigin="anonymous"` on the emitted `assets/index-*.js` tag (it does for `<script type="module" crossorigin>` in `index.html`, but the current attribute is the explicit `crossorigin="anonymous"` value — verify the build output and add a `src/test/smoke/index-html-crossorigin.smoke.test.ts` that parses `dist/index.html` post-build and asserts every `<script>` carries `crossorigin`). This guarantees future bundles surface real stack frames instead of the opaque message, so when something legitimately breaks we get a debuggable error.

## BDD scenarios

Insert into `bdd_scenarios`:

- `TRIAGE-NOISE-030` — `triage-error` returns 409 `auto_silenced` and resolves the row when invoked on an opaque `Script error.` fingerprint; AI call counter does not increment.
- `TRIAGE-NOISE-031` — `triage-error` returns 409 `auto_silenced` for any active `known_issue_catalog` match; row flipped to resolved with `dismissed_reason` set.
- `TRIAGE-NOISE-032` — One-time cleanup migration deletes all pre-trigger opaque rows from `agent_fix_queue` and `audit_log` and records a single maintenance audit row.
- `TRIAGE-NOISE-033` — CI script `check-no-opaque-script-error.mjs` exits non-zero when an opaque row exists in the last 24h, zero when none.
- `TRIAGE-NOISE-034` — Production `dist/index.html` `<script>` tags all carry `crossorigin`; smoke test fails the build otherwise.

## Files

- `supabase/functions/triage-error/index.ts` — pre-AI silencer (regex + known_issue_catalog lookup + auto-resolve).
- New migration `purge_legacy_opaque_script_error_rows.sql` — one-time delete + audit row.
- `scripts/ci/check-no-opaque-script-error.mjs` + wire into `.github/workflows` (or existing quality job runner).
- `src/test/smoke/index-html-crossorigin.smoke.test.ts` — post-build assertion.
- `bdd_scenarios` insert.
- Memory updates: extend `mem://features/triage-noise-suppression` with the new server-side gate + CI guard; bump the index Core line.

## What this is NOT

- Not a new client-side filter (already in place at every reporter entrypoint).
- Not a new DB trigger (already in place since 2026-06-02 19:43).
- Not a band-aid resolve of the visible row — the migration hard-deletes the class so it cannot be re-triaged and cannot reappear in any UI sort.
