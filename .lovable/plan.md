## Root cause

Four distinct production bugs land on the same triage page. Each gets a permanent fix.

### Bug A — `process-freescout-events` returns 401 every 15s (`authn_unauthorized`)
`supabase/functions/process-freescout-events/index.ts:11-17` checks bearer with `tok === SUPABASE_SERVICE_ROLE_KEY` (literal equality only). Per the established `process-email-queue` pattern (memory: Email Queue Cron Bulk + Keys), the cron worker MUST also accept a legacy `service_role` JWT (Supabase sometimes sends one and sometimes the new opaque `sb_secret_*` token). Right now every cron wake (4×/min) returns 401, no events are drained, AND each 401 flips `authn_unauthorized` into the triage queue. Edge logs confirm the steady-state 401 storm.

### Bug B — `discover_audit_fingerprints` re-promotes every audit row to `severity='error'`
`discover_audit_fingerprints` (server cron) scans `audit_log` for the last 24h and **hard-codes** `severity='error'` on the `INSERT INTO agent_fix_queue`, ignoring whatever severity the client reporter wrote into `audit_log.changed_fields`. So:

- `freescoutInvoke` reports `freescout-proxy listMine invoke_error` at `severity:"warn"` ✓
- Client reporter correctly **skips** the direct queue write (`args.severity !== "error"` guard at `error-reporter.service.ts:316`) ✓
- BUT it still writes the audit row (correct) ✓
- Discovery picks it up next cycle and force-inserts at `error`, escalating it past HELP-DESK-024 ✗

This single defect explains the `freescout-proxy listMine invoke_error` row (and every previous warn-severity edge-invoke noise that has been ranked as an error). It also defeats the Triage Noise Suppression policy: the client correctly classifies the event as warn, then the server escalates it back.

### Bug C — `isOpaqueScriptError` predicate breaks on multi-line payloads
`error-reporter.service.ts:501-511` strips `^Error:` and trailing `.`, then asserts equality to `"Script error"`. The real production payload is multi-line:
```
Error: Script error.
ih@https://techfleet.network/assets/index-xwXUwr4r.js:2:23615
...
```
Normalization keeps the embedded newlines, equality fails, the event leaks through. It also only runs in `window.onerror`; the React error-boundary path (`reportError` → `reportToAuditLog`) has no opaque-error guard, so a synthesized `dispatchEvent` Script error always lands in audit + triage.

### Bug D — Stale rows
`agent_fix_queue.3662cf6a` (Script error, triaged) and `ce7fff5d` (Script error, proposed) remain visible; `112cf9f4` (listMine invoke_error) is already `resolved` but will recur until Bug B is fixed.

`client_error_suppressed` / `client_error_deduped` are intentionally observability-only (already in `v_excluded_events`) — they appear in the Activity Log, not Triage. No fix needed; documented in BDD.

## Permanent fix

### 1. Cron auth parity (Bug A)
- **New** `supabase/functions/_shared/service-role-auth.ts` exporting `authorizeServiceRoleRequest(req): { ok: true } | { ok: false, status: 401|403, body: { error: string } }`. Accepts both legacy JWT (`claims.role === 'service_role'`) and opaque `sb_secret_*` (`token === SUPABASE_SERVICE_ROLE_KEY`). Mirror of the proven `process-email-queue` logic.
- `process-freescout-events/index.ts`: replace inline `authorized()` with the helper. Returns 401 only when bearer is missing/malformed; 403 when present but doesn't match. Both flagged severity=`warn` (cron noise, not actionable).
- `process-email-queue/index.ts`: refactor to import the same helper (DRY; ensures one place to evolve cron auth). No behavior change.
- Deploy both functions.

### 2. Discovery respects client severity (Bug B)
- **Migration** updates `discover_audit_fingerprints` so the inner `SELECT` from `audit_log`:
  - aggregates `bool_or('severity:error' = ANY(changed_fields))` per fingerprint as `v_any_error`.
  - the per-row `INSERT INTO agent_fix_queue` uses `'error'` when `v_any_error`, else **skips** the row entirely (counted in `v_silenced`).
  - adds a backstop event-type exclusion list mirroring the client's `NON_ACTIONABLE_EVENT_TYPES` (e.g. `edge_invoke_failed`, `validation_rejected`, `email_frequency_capped`) — when severity-tag is absent (legacy rows), still drop these. Document the dual gate inline.
- This is the root fix for HELP-DESK-024 (CORS trace + warn severity) actually holding end-to-end.

### 3. Opaque Script error — first-line predicate + dual-path guard (Bug C)
- `error-reporter.service.ts`:
  - Replace `isOpaqueScriptError(event, msg)` with message-level `isOpaqueScriptErrorMessage(msg)` that splits on `/\r?\n/`, takes the first non-empty line, and matches `/^(error:\s*)?script error\.?$/i`.
  - Call the new predicate as the **very first** check inside `reportError()` AND `reportToAuditLog()` — both return early before writing audit OR queue, no "suppressed" aggregate (the event is structurally non-debuggable; counting it doesn't help admins).
  - Keep the window.onerror call as a thin wrapper around the same predicate (DRY).
- **Migration** inserts a `known_issue_catalog` row: `{ pattern: 'Script error', match_kind: 'substring', event_type_filter: 'client_error', is_active: true }` and a second row scoped to `event_type_filter: NULL` (for unhandledrejection) — belt-and-braces backstop in case a future caller bypasses the client predicate.
- `index.html`: add `crossorigin="anonymous"` to the entry `<script type="module" src="/src/main.tsx">`. Vite already injects this on build, but make it explicit so dev preview and source maps also carry it.

### 4. Resolve stale queue rows + memory
- `UPDATE agent_fix_queue SET status='resolved', resolved_at=now(), dismissed_reason='triage_root_cause_shipped'` for ids `3662cf6a-125f-47b1-b0a6-835e307ee90f` and `ce7fff5d-7c08-4a78-bae0-bae75bdbd079`.
- Append a memory file `mem://features/triage-discovery-severity-gate` and amend `mem://features/triage-noise-suppression` to record the 7th layer (discovery severity gate) and the dual-path Script error filter. Update the core index entry.

### 5. BDD scenarios (inserted into `bdd_scenarios`)
Each carries tri-layer Then-clauses.

- **TRIAGE-NOISE-010** — Warn-severity audit rows never enter Triage via discovery
  - Given the client reports `edge_invoke_failed` with `severity:warn`
  - When `discover_audit_fingerprints(1)` runs
  - Then [UI] System Health Triage shows no new row · [DB] no `agent_fix_queue` row · [Code] discovery counts the fingerprint in `silenced` and skips the INSERT.

- **TRIAGE-NOISE-011** — Error-severity rows still flow
  - Given a `client_error` with `severity:error` in audit
  - Then [UI] row appears in Triage at `severity='error'` · [DB] `agent_fix_queue.severity='error'` · [Code] `bool_or('severity:error' = ANY(changed_fields))` is true.

- **TRIAGE-NOISE-012** — Multi-line "Script error." is dropped at the source
  - Given a window.onerror or React dispatchEvent with body `"Error: Script error.\n<stack>"`
  - Then [UI] no Triage row, no toast · [DB] no `audit_log` insert, no `agent_fix_queue` row · [Code] `isOpaqueScriptErrorMessage` returns true on first non-empty line; both `reportError` and `reportToAuditLog` short-circuit.

- **HELP-DESK-033** — `process-freescout-events` accepts both bearer formats
  - When cron wakes the worker with a legacy service-role JWT, then with an opaque `sb_secret_*`
  - Then [UI] no `authn_unauthorized` row in Triage · [DB] freescout events drain from `q_freescout_events` (msg_id removed) · [Code] both branches in `authorizeServiceRoleRequest` return `{ok:true}`.

- **HELP-DESK-034** — Missing/invalid bearer is rejected without flooding triage
  - When the worker is called without a bearer (401) or with an unknown bearer (403)
  - Then [UI] no Triage row · [DB] discovery does not enqueue (severity=`warn` on the audit row) · [Code] helper logs at severity=`warn`.

### 6. Smoke tests
- `src/test/smoke/opaque-script-error.smoke.test.ts` — feeds the exact multi-line payload from the user report into both `reportError` and the simulated `window.onerror`, asserts `write_audit_log` and `upsert_fix_queue_entry` spies are NEVER called.
- `supabase/functions/process-freescout-events/auth.test.ts` — Deno test for both branches of `authorizeServiceRoleRequest`.

## Out of scope

- Refactoring `discover_audit_fingerprints` to also dedupe across `process-freescout-events` 401s already in `agent_fix_queue` from earlier today — they'll be silenced naturally on the next 24h discovery window once Bug A is patched.
- A System Health "Why was this silenced?" inspector — useful, but a separate UX project.
- Removing `x-trace-id` from `freescoutInvoke` (kept; HELP-DESK-024 already validated).

## Files touched

```text
supabase/functions/_shared/service-role-auth.ts                 (NEW)
supabase/functions/process-freescout-events/index.ts            (use helper)
supabase/functions/process-email-queue/index.ts                 (use helper, no behavior change)
supabase/functions/process-freescout-events/auth.test.ts        (NEW)
supabase/migrations/<ts>_discover_severity_gate.sql             (NEW — patches discover_audit_fingerprints + known_issue_catalog inserts + queue resolves)
src/services/error-reporter.service.ts                          (first-line predicate, dual-path guard)
src/test/smoke/opaque-script-error.smoke.test.ts                (NEW)
index.html                                                      (explicit crossorigin on entry script)
bdd_scenarios                                                   (TRIAGE-NOISE-010..012, HELP-DESK-033..034)
mem://features/triage-discovery-severity-gate                   (NEW)
mem://features/triage-noise-suppression                         (append layer 7 + dual-path note)
mem://index.md                                                  (core line refresh)
```

## Verification

1. Deploy `process-freescout-events`, `process-email-queue`, `send-transactional-email` is unchanged.
2. Tail edge logs for 1 minute → confirm `process-freescout-events` returns 200 on cron wake.
3. Manually invoke `select * from public.discover_audit_fingerprints(1);` → confirm `silenced` includes the warn-severity rows; `queued` only contains real errors.
4. Run `bunx vitest run src/test/smoke/opaque-script-error.smoke.test.ts`.
5. Trigger a synthetic "Script error." via console (`window.dispatchEvent(new ErrorEvent('error', {message:'Script error.'}))`) → confirm zero new `audit_log` rows and zero Triage rows.
6. 24h later: no new `freescout-proxy * invoke_error` or `authn_unauthorized` rows in `agent_fix_queue`.
