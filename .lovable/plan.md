
## Why the AI-proposed fix is wrong

`crossorigin="anonymous"` is **already** set on the entry module (`index.html:224`) and on every dynamically injected third-party script (GTM, Clarity, CookieYes — see `src/lib/consent/loadAnalytics.ts` and `src/components/CookieConsentBanner.tsx`). Memory entry `[Scoped Error Boundaries]` confirms this.

The opaque payload `Error: Script error.` still landed in `agent_fix_queue` (rows `ce7fff5d…` at 16:30 and `3662cf6a…` at 16:23 today). Tracing it: the message went `installGlobalErrorReporter → chunkAwareReport → reportToAuditLog → writeAudit → write_audit_log RPC → audit_log → discover_audit_fingerprints → agent_fix_queue`. The JS regex `isOpaqueScriptErrorMessage` matches the payload correctly (smoke test green), yet the row was written — meaning some build/runtime path skipped or pre-dated the JS filter. The pattern repeats every few weeks: a refactor forgets the filter, or a new caller writes directly to `write_audit_log`, and the noise returns.

## Root cause (permanent)

The JS filter is **the only line of defense**. There is no DB-level trigger on `audit_log` rejecting opaque-script payloads. As long as defense lives only in client JS, every new write path is one bug away from re-introducing the regression. We need a database-level invariant that is impossible to bypass.

## Permanent fix

### 1. Database: `BEFORE INSERT` trigger on `audit_log`

```sql
create or replace function public.reject_opaque_script_error()
returns trigger language plpgsql as $$
declare
  first_line text;
begin
  -- First non-empty trimmed line of error_message.
  select btrim(line) into first_line
  from unnest(string_to_array(coalesce(new.error_message, ''), e'\n')) as line
  where btrim(line) <> ''
  limit 1;

  if first_line ~* '^(error:\s*)?script error\.?$' then
    -- Silently drop: telemetry must never throw for the caller, and we don't
    -- want a single noisy beacon to fail an entire user action.
    return null;
  end if;
  return new;
end $$ set search_path = public;

create trigger trg_audit_log_reject_opaque_script_error
before insert on public.audit_log
for each row execute function public.reject_opaque_script_error();
```

### 2. Defense-in-depth trigger on `agent_fix_queue`

Same predicate, separate trigger — so any future ingestion path (e.g. another discovery scanner, manual admin insert, edge replay) is also blocked.

### 3. Backfill

```sql
update public.agent_fix_queue
   set status = 'resolved',
       resolution_note = coalesce(resolution_note,'') ||
         e'\n[auto] opaque cross-origin Script error — closed by permanent DB backstop'
 where status <> 'resolved'
   and error_message ~* '^(error:\s*)?script error\.?(\n|$)';
```

### 4. Refresh `known_issue_catalog` entries

Bump the existing two rows' `reason` to reference the trigger as the authoritative source (kept for human discoverability only — the trigger is now the enforcement point).

### 5. Tests

- **Postgres smoke test** (added to `src/test/smoke/triage-permanent-fixes.smoke.test.ts`): `insert into audit_log (...) values (...'Error: Script error.\nih@…')` then `select count(*)` returns 0.
- Keep existing `src/test/smoke/opaque-script-error.smoke.test.ts` (JS regex).
- Add `pg_dump`-style migration assertion in CI: trigger must exist and be enabled (`scripts/ci/check-audit-triggers.sh`).

### 6. BDD scenarios (`bdd_scenarios`)

- **TRIAGE-NOISE-020** — Given a client emits `Error: Script error.` with a multi-line stack, When the row is sent to `write_audit_log`, Then [DB] no row is written to `audit_log`, [DB] no row is written to `agent_fix_queue`, [UI] System Health Triage tab does not display the fingerprint.
- **TRIAGE-NOISE-021** — Given a row already exists in `agent_fix_queue` whose `error_message` first line is `Script error`, When the backfill migration runs, Then [DB] the row's `status` is `resolved` and `resolution_note` contains `permanent DB backstop`, [UI] the Triage queue badge count decreases accordingly.
- **TRIAGE-NOISE-022** — Given an admin attempts a direct insert into `agent_fix_queue` with payload `Script error.`, When the insert runs, Then [DB] the row is silently dropped (`returning *` empty), [Code] the calling edge function receives no error, [UI] no entry appears in the Triage tab.

### 7. Memory update

Append to `mem://features/triage-noise-suppression`: layer 7 = DB BEFORE-INSERT trigger on `audit_log` and `agent_fix_queue` rejecting `^(error:\s*)?script error\.?$` on first non-empty line — the only enforcement that survives client/edge refactors.

## Why this never happens again

The trigger lives in the database, has no JS/edge dependency, runs on every insert path (client RPC, edge function, cron scanner, manual SQL), and is asserted by both Vitest and a CI script. Removing it requires writing an explicit `drop trigger` migration, which will fail review.

## Out of scope

- No change to existing JS filters (kept as early-drop optimization).
- No change to `crossorigin` attributes (already correct).
- No change to discovery scanner severity gate (orthogonal).
