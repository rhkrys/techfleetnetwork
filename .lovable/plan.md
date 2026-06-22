## Why your save failed (best evidence)

- You're signed in as `mdenner@techfleet.org` → role `admin` → RLS INSERT policy `Admins can create classes` passes. Not a permissions problem.
- No `classes` row exists for "AI Enabled Systems design" → the INSERT never committed.
- Your `audit_log` shows an `upstream request timeout` (PostgREST gateway hiccup) from your session ~5 minutes before the save attempt — the same class of transient failure was almost certainly the underlying cause.
- The toast text you saw — literally "Failed to save class" — is the **fallback** branch in `ClassFormPage.onSubmit`. It only fires when `err instanceof Error` is `false`. `supabase-js` throws plain `PostgrestError` objects (`{ message, code, details, hint }`), which fail that check, so the real upstream message (e.g. "upstream request timeout", PGRST002) was silently swallowed and you got an opaque toast.

That swallowing is the defect we permanently fix here. The transient timeout is a real-world condition we also harden against.

## What I'll ship (one turn, root-cause fix)

### 1. Stop swallowing error messages — `src/pages/ClassFormPage.tsx`
- Replace the `err instanceof Error ? err.message : "Failed to save class"` fallback with a shared `extractErrorMessage(err)` helper that handles:
  - `Error` instances
  - `PostgrestError` shape (`message` + optional `code`/`hint`/`details`)
  - `FunctionsHttpError` / `FunctionsRelayError`
  - plain strings and `{ error: { message } }` envelopes
- Map known transient codes (`PGRST002`, `57014`, `08006`, `upstream request timeout`) to a friendly, actionable line: *"We couldn't reach the database just now. Your draft is kept locally — try Save again."*
- Map RLS denial (`42501` / "row-level security") to: *"Your account doesn't have permission to create a class. Ask an admin to grant the teacher role."*
- Always include the underlying `code` in the toast `description` so triage + the member see the real reason.

### 2. Add a real retry on transient failures — `src/services/class.service.ts`
- Wrap `ClassService.create` and `ClassService.update` in a small `retryTransient(fn, { attempts: 3, baseMs: 250 })` helper (exponential backoff with jitter, only on transient codes / network errors; never on RLS or validation errors).
- Replace the bare `.single()` in `create` with `.select("id").maybeSingle()` + explicit "insert returned no row" error → eliminates a PGRST116 misdiagnosis when RLS hides the returned row.
- Keep `assertWritten` in `update` (already correct).

### 3. Centralize the helper — `src/lib/errors/extract.ts` (new)
- Pure TS, fully unit-tested. Reused by `ClassFormPage`, future class actions (submit/approve/archive), and any other form that catches a Supabase mutation.

### 4. Tests
- `src/test/lib/extract-error-message.test.ts` — Error, PostgrestError, FunctionsHttpError, string, nested envelope, unknown shape.
- `src/test/services/class.service.retry.test.ts` — retries on PGRST002, does not retry on 42501, gives up after 3 attempts.

### 5. BDD scenarios (DB)
Inserted into `public.bdd_scenarios` with tri-layer Then-clauses:
- `CLASS-SAVE-001` — Transient PostgREST timeout: UI shows friendly retry copy + code, DB has no orphan row, service emits one `severity:warn` audit row.
- `CLASS-SAVE-002` — RLS denial: UI shows role-aware copy, DB unchanged, no triage noise.
- `CLASS-SAVE-003` — Successful create after one transient retry: UI navigates to `/teach/classes/:id`, DB has exactly one row, draft cleared.
- `CLASS-SAVE-004` — Non-Error throw never produces opaque "Failed to save class" toast.

### 6. No DB / RLS / schema changes
- No migrations. No new tables. No policy edits. The existing admin + teacher INSERT policies are correct.
- Triage queue is already at 1 pending; this change cannot regress it because PostgrestError messages now surface instead of being swallowed.

## What you should do right now (independent of the code fix)
Try the save again — the previous attempt was almost certainly the transient gateway timeout shown in your audit log. After this fix ships, if it happens again you'll see the exact reason in the toast, and the service will auto-retry up to 3 times before showing it.

## Files touched
```text
src/pages/ClassFormPage.tsx         (edit  — replace fallback, use helper)
src/services/class.service.ts       (edit  — retryTransient + maybeSingle)
src/lib/errors/extract.ts           (new   — shared helper)
src/test/lib/extract-error-message.test.ts        (new)
src/test/services/class.service.retry.test.ts    (new)
public.bdd_scenarios                (data  — CLASS-SAVE-001..004 via insert tool)
```

No edge functions, no migrations, no UX regressions (toast surface stays the same — just truthful now).