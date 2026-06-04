## Goal

Stop three benign / already-fixed signals from ever re-entering the Triage queue, and resolve the existing rows.

## Root causes (verified in DB)

1. **"Reconciled — original sent at …"** — `audit_email_send_log` trigger writes ANY `email_send_log` insert (including the benign `status='reconciled'` reconciliation note) to `audit_log` with `error_message=NEW.error_message` populated and no `severity:info` tag. `discover_audit_fingerprints` then promotes it to `agent_fix_queue` as `severity='error'`. Same fall-through applies to `rate_limited`, `frequency_capped`, `suppressed`.
2. **`ZodError: [ … "registration_url" … "Registration URL is required" ]`** — react-hook-form's async zodResolver path lets a ZodError leak to `window.unhandledrejection`. The global reporter classifies it as `client_error severity=error` and routes it to Triage. `reportValidationRejection`'s required-only filter is bypassed because nobody calls it from the unhandledrejection path.
3. **`column reference "metric_key" is ambiguous`** — function fixed last turn (`#variable_conflict use_column` + DB-wide backfill + CI guard). Only the historical fingerprints remain in `agent_fix_queue`.

## Changes

### A. Benign email-lifecycle events never reach Triage

**Migration** — rewrite `audit_email_send_log` so benign statuses (`reconciled`, `rate_limited`, `frequency_capped`, `suppressed`) write to `audit_log` with:
- `error_message = NULL` (the human note moves into `changed_fields` as `note:<truncated>`),
- `changed_fields` includes `severity:info`.

This makes `discover_audit_fingerprints` skip them via the existing `has_severity_tag AND NOT any_error` branch.

**Defense in depth** — extend `discover_audit_fingerprints.v_excluded_events` with `'email_reconciled'`, `'email_rate_limited'`, `'email_frequency_capped'`, `'email_suppressed'`.

**Client mirror** — add the same four event types to `NON_ACTIONABLE_EVENT_TYPES` in `src/services/error-reporter.service.ts` so any client-side echo also stays out of the queue.

**Backlog purge** — in the same migration:
```sql
UPDATE public.agent_fix_queue
SET status='resolved', resolution_note='Auto-resolved: benign email lifecycle event reclassified',
    updated_at=now()
WHERE status IN ('pending','triaged','proposed')
  AND event_type IN ('email_reconciled','email_rate_limited','email_frequency_capped','email_suppressed');
```

### B. ZodError unhandled rejections classified, never severity=error

**`src/services/error-reporter.service.ts`**:
- Add `isZodErrorMessage(msg)` classifier (matches `^ZodError:` plus a parseable JSON issues array).
- Add `classifyZodError(msg)`: parses the issues; if every issue is `too_small` / `invalid_type` / required-text → return `"required"` (drop silently with `recordSuppression('__zod_required__')`); otherwise return `"meaningful"` and route via `reportToAuditLog` with `eventType:"validation_rejected"`, `severity:"warn"`.
- Hook the classifier at the top of `chunkAwareReport` and at `reportError` entrypoints, BEFORE the default `client_error severity=error` path.

This converts the registration_url case (all `too_small` + required) into a silent drop (with aggregate `client_error_suppressed` flush) and keeps real schema/regex regressions visible at `warn` in System Health.

**Form hardening (defense in depth)** — wrap `form.handleSubmit(onSubmit)` in `CohortFormPage.tsx` so a rejected promise from the resolver can't escape:
```tsx
<form onSubmit={(e) => { void form.handleSubmit(onSubmit)(e).catch(() => {}); }}>
```
Apply the same pattern to any other page that uses an async zodResolver with `handleSubmit` directly inline.

**Backlog purge** — same migration:
```sql
UPDATE public.agent_fix_queue
SET status='resolved', resolution_note='Auto-resolved: ZodError reclassified as validation_rejected'
WHERE status IN ('pending','triaged','proposed')
  AND error_message ILIKE 'ZodError:%';
```

### C. metric_key ambiguity backlog

```sql
UPDATE public.agent_fix_queue
SET status='resolved', resolution_note='Auto-resolved: fixed by plpgsql variable_conflict guard + DB backfill'
WHERE status IN ('pending','triaged','proposed')
  AND error_message ILIKE '%column reference "metric_key" is ambiguous%';
```

### D. BDD + memory

Append scenarios to `bdd_scenarios`:
- `EMAIL-RECON-NOISE-001` — reconcile_stuck_emails appends a reconciled row → audit_log has severity:info, agent_fix_queue unchanged.
- `TRIAGE-NOISE-013` — unhandledrejection ZodError with only required-field issues → no audit_log row, suppression counter increments.
- `TRIAGE-NOISE-014` — unhandledrejection ZodError with a regex/refine failure → audit_log row event_type=validation_rejected severity=warn, agent_fix_queue unchanged.

Memory: update `mem://features/triage-noise-suppression.md` with the four new benign email event types and the ZodError classifier; update `mem://index.md` Core line on triage noise suppression to mention "ZodError unhandled rejections classified as validation_rejected (warn) or dropped when required-only".

## Files

- `supabase/migrations/<ts>_silence_benign_email_and_zod_triage.sql` — trigger rewrite, discover exclusion list, backlog purge.
- `src/services/error-reporter.service.ts` — ZodError classifier + NON_ACTIONABLE additions.
- `src/pages/CohortFormPage.tsx` — `void … .catch(() => {})` wrap.
- BDD scenarios insert.
- `mem://features/triage-noise-suppression.md`, `mem://index.md`.

## Out of scope

- Changing reconciler behavior (it's correct; only its audit shape is wrong).
- Touching `get_refactor_kpis` again (already fixed).
- Rewriting Zod schema for `registration_url` (the schema is correct; the leak is at the reporter layer).
