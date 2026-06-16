## Triage queue current state (live evidence)

`agent_fix_queue` has 8 `pending` rows. All of them collapse into 3 root causes:

| # | Fingerprint / source | Root cause |
|---|---|---|
| 1–2 | `process-email-queue` `email_rate_limited` ×2 | Worker upserts directly into `agent_fix_queue` with `severity='error'` for the transactional lane on Resend 429 cooldown. The DB trigger that's supposed to block non-actionable event types **does not list `email_rate_limited`**, even though the JS reporter does (`NON_ACTIONABLE_EVENT_TYPES`) and so does `discover_audit_fingerprints` (`v_excluded_events`). Three sources of truth, only two agree → direct insert wins. |
| 3 | `email_send_log` `email_failed` "Failed to mint unsubscribe token" | `auth-email-hook` upsert→re-SELECT pattern (lines 332–352) overwrites a freshly minted token with `null` when the upsert errors for ANY reason (not just a unique-violation race). On a transient PostgREST blip (`PGRST002`/`57014`) the re-SELECT also returns empty, so `unsubscribeToken` becomes `null` and the function inserts a synthetic `failed` row. The status='failed' trigger then emits `email_failed` into `audit_log`; discover queues it at `severity='error'`. |
| 4–8 | `getReadIds` 57014, `getNetworkStats` PGRST002, `query.public-project-openings` upstream timeout, `frontend` "Failed to load progress" PGRST002, `unhandledrejection` "Failed to count progress" 57014 | Transient Postgres/PostgREST infra errors that are **already classified by `src/lib/transient-error.ts`** (codes `PGRST002`, `57014`, `57P0x`, `53300`, …) but that classifier is **never consulted by `reportError()` or `classify()`**. So `handleServiceError` and direct service-layer reports flag every transient blip as `severity='error'` → triage queue. |

## Why this is a single architectural defect, not 8 bugs

There are three independent paths that can land a row in `agent_fix_queue` at `severity='error'`:

```text
A. Direct insert  (process-email-queue, send-project-blast, etc.)
B. reportError → write_audit_log → triage RPC upsert_fix_queue_entry
C. audit_log → cron discover_audit_fingerprints → queue insert
```

Each path has its own non-actionable allowlist:

- A is governed only by the DB trigger `block_non_actionable_fix_queue_inserts`
- B is governed by `NON_ACTIONABLE_EVENT_TYPES` in `error-reporter.service.ts`
- C is governed by `v_excluded_events` in `discover_audit_fingerprints`

The three lists have drifted. None of the three knows about **infra-transient PG codes** at all. That's why every transient PGRST002/57014/429 reaches Triage no matter which path it enters by.

## Permanent fix (one principle, applied uniformly)

> **There is exactly one source of truth for "what is actionable in Triage": a `public.is_actionable_event_type(event_type)` SQL function + a structural `isTransientError(err)` TS classifier. Every path consults both.**

### 1. DB: single source of truth for actionable event types

- New SQL function `public.is_actionable_event_type(p_event_type text, p_changed_fields text[]) returns boolean` that returns false for the union of all three current lists plus the missing items (`email_rate_limited`, `email_reconciled`, `email_frequency_capped`, `email_suppressed`, `validation_rejected`, `infra_transient`). Also returns false when `changed_fields` contains a `severity:` tag other than `severity:error` (consistent with `discover_audit_fingerprints`).
- Rewrite `block_non_actionable_fix_queue_inserts()` and `discover_audit_fingerprints()` to call `is_actionable_event_type(...)`. Both paths now share one list — they cannot drift again.

### 2. TS reporter: consult the transient classifier before writing

- In `reportError()` (`src/services/error-reporter.service.ts`), before `reportToAuditLog(...)`:
  ```ts
  if (isTransientError(err)) {
    options.eventType = "infra_transient";
    options.severity  = "info";
  }
  ```
  `infra_transient` is added to `NON_ACTIONABLE_EVENT_TYPES` and to the new SQL function, so neither path B nor the audit row written for it can reach the queue.
- In `src/lib/observability/classify.ts`, fold `isTransientError(value)` into `classify()`: when it matches, return `{ report: false, reason: "infra_transient", retriable: true }`. This stops React Query's `QueryCache.onError` from writing anything for transients (currently it writes `query_failed warn`, which is harmless but redundant).
- `handleServiceError` (`src/lib/service-result.ts`) now passes the *original* error to `reportError(error, action, { ... })` instead of a pre-formatted message string, so the classifier can see `code` / `status` fields. Today it stringifies first and the classifier loses the structured fields — that's why PGRST002/57014 always slip through.

### 3. Email worker: stop the direct severity=error insert

In `supabase/functions/process-email-queue/index.ts` (line 675 block):

- Delete the direct `agent_fix_queue` upsert.
- The same information already reaches admins via:
  - `email_send_log` insert with `status='rate_limited'` → `audit_email_send_log` trigger writes `event_type='email_rate_limited'` to `audit_log`, which discover already excludes (no queue noise, but visible in System Health → Email tab and Activity Log).
  - `email_send_state.consecutive_429_count_transactional` + cooldown row, which the System Health Email card already reads.
- No information loss; one less drift surface.

### 4. Unsubscribe-token mint: atomic, race-free

In `supabase/functions/auth-email-hook/index.ts` (lines 332–352), replace the read-then-upsert-then-reread dance with a single atomic upsert:

```ts
const fresh = Array.from(crypto.getRandomValues(new Uint8Array(32)))
  .map(b => b.toString(16).padStart(2, '0')).join('')

const { data: row, error: tokenErr } = await supabase
  .from('email_unsubscribe_tokens')
  .upsert(
    { email: normalizedEmail, token: fresh },
    { onConflict: 'email', ignoreDuplicates: false }
  )
  .select('token')
  .single()

if (tokenErr || !row?.token) throw new Error(`mint_unsubscribe_token: ${tokenErr?.message ?? 'no row'}`)
unsubscribeToken = row.token
```

Why this is the permanent fix:
- `ignoreDuplicates: false` + `onConflict: 'email'` + `.select().single()` is atomic in PostgREST; it always returns the canonical row (either the freshly inserted one or the existing one). No race window, no null overwrite.
- Errors are propagated to the outer try/catch where they're handled once, not duplicated into `email_send_log` as a synthetic `failed` row.
- The unique constraint on `email` makes this provably the row we want; there is no second SELECT to lose.

### 5. Clean up the 8 stale rows once the fix ships

Add a deploy-time call to the existing `resolve_stale_fingerprints_on_deploy('email_rate_limited|Failed to mint unsubscribe token|Failed to load progress|Failed to count progress|Failed to load project openings|PGRST002|57014', 'permanent_fix_2026_06_16')` so the existing pending rows are auto-resolved with a documented reason — no manual UI clicks, auditable.

## Proof this prevents regression

- **Single SQL function** (`is_actionable_event_type`) is unit-tested and called by both write paths (trigger + discover). New event types must be added there or they're treated as non-actionable by default. Drift is structurally impossible.
- **Structural classifier**: `isTransientError` already has 14 PG codes + 6 HTTP statuses + 16 message patterns covered by `src/test/...` smoke tests. Folding it into `classify()` and `reportError()` extends coverage to every reporter entry point in a single call — no per-callsite opt-in.
- **Atomic upsert** removes the only code-level data race; PostgreSQL's `ON CONFLICT DO UPDATE` guarantees a returned row.
- **Direct queue insert deleted** from `process-email-queue`; no other call sites do this for `email_rate_limited` (grep-verified).
- **New BDD scenarios** (TRIAGE-ROOT-001..006) lock in:
  - PGRST002 from any service never reaches `agent_fix_queue`
  - 57014 from any service never reaches `agent_fix_queue`
  - workspace 429 cooldowns never reach `agent_fix_queue`
  - mint-token race produces exactly one row, returns its token, no `email_failed` audit row
  - `block_non_actionable_fix_queue_inserts` and `discover_audit_fingerprints` agree byte-for-byte on the blocked set (asserted by SQL test).
- **CI guard**: `scripts/ci/check-triage-actionable-parity.mjs` greps the JS `NON_ACTIONABLE_EVENT_TYPES` and asserts every entry is also returned `false` by `is_actionable_event_type` against a static fixture. Build fails if a future PR drifts the lists.

## Files changed

- `supabase/migrations/<ts>_triage_actionable_single_source.sql` — new `is_actionable_event_type`; rewrite `block_non_actionable_fix_queue_inserts` + `discover_audit_fingerprints` to call it; add `infra_transient` event type to all event-type CHECK constraints if any.
- `supabase/migrations/<ts>_resolve_stale_triage_2026_06_16.sql` — one-shot `resolve_stale_fingerprints_on_deploy(...)` call.
- `src/services/error-reporter.service.ts` — short-circuit to `infra_transient`/`info` when `isTransientError(err)` matches; add `infra_transient` to `NON_ACTIONABLE_EVENT_TYPES` and `ReportEventType`.
- `src/lib/observability/classify.ts` — fold `isTransientError` into `classify()`.
- `src/lib/service-result.ts` — pass the structured error to `reportError`, not a pre-flattened string.
- `supabase/functions/process-email-queue/index.ts` — delete direct `agent_fix_queue` upsert (lines 662–687 block).
- `supabase/functions/auth-email-hook/index.ts` — replace read-upsert-reread with one atomic upsert returning the token.
- `scripts/ci/check-triage-actionable-parity.mjs` — new CI guard.
- `src/test/regression/incidents/triage-root-cause-2026-06-16.test.ts` — new TS tests for classifier integration.
- `supabase/migrations/<ts>_bdd_triage_root_cause.sql` — TRIAGE-ROOT-001..006 BDD scenarios.

## Non-goals / safety rails

- No change to `audit_log` retention or hash-chain.
- No RLS loosening on any table.
- No change to actually-actionable event types (`client_error`, `ui_render_error`, `email_failed` for real send failures, etc.) — only transient/non-actionable categories are touched.
- `process-email-queue` still records 429 cooldowns to `email_send_state` and `email_send_log`; the System Health Email card continues to show them. The only thing that disappears is the duplicate severity=error fix-queue row.
- No member-facing UX changes.