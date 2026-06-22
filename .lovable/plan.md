# Edit Project save hangs forever — permanent fix

## Symptom
On `/admin/clients` → edit a project → **Save**, the request spins indefinitely. No toast. No error. Every edit fails the same way. (Backend logs show intermittent `connection closed before message completed` and `canceling statement due to statement timeout` on adjacent project endpoints, confirming Cloud → PostgREST flapping.)

## Root cause
`src/pages/ProjectFormPage.tsx` calls `supabase.from("projects").update(...).eq("id", id)` inside a React Query mutation with **no timeout, no retry, no resolve-indeterminate**. When PostgREST drops the response mid-flight, the promise never settles → button stays in "Saving…" forever and the user has no recourse. Same shape of bug as the sign-up indeterminate-timeout class we just fixed — but for the admin project editor.

Two contributing factors found in the DB:
1. `public.projects` has **two identical triggers** firing the same function (`trg_enqueue_ugc_translations` AND `trg_ugc_translate_projects` → both → `enqueue_ugc_translation_jobs`). Doubles the per-row cost on every UPDATE.
2. There is no client-visible signal when the trigger work (UGC enqueue, audit write, notify_project_opening) pushes the UPDATE past the statement timeout window.

## Permanent fix (one shipment, no band-aids)

### A. Bounded save + indeterminate-resolve in `ProjectFormPage.tsx`
- Wrap both `updateMutation.mutationFn` and the `useAutosave` `onSave` in a `withBoundedSave(fn, { timeoutMs: 15_000 })` helper:
  - If the supabase call resolves first → normal path.
  - If the timeout wins → run a **resolve probe**: `SELECT id, updated_at, <key fields> FROM projects WHERE id = :id` and compare to the submitted values. 
    - Match → treat as saved → success toast + invalidate caches + navigate. Beacon `admin.project.save.indeterminate_resolved { outcome: "persisted" }` (severity `info`).
    - Mismatch → throw a typed `SaveIndeterminateError` → show toast "We couldn't confirm the save. Try again." with a Retry button. Beacon outcome `unresolved` (severity `warn`).
- Surface a real error toast on every failure path (including the new `SaveIndeterminateError`); never let the button hang.
- Add an `aria-live="polite"` status under the Save button: "Saving…" → "Checking whether your changes were saved…" → "Saved" / "Couldn't confirm".

### B. Drop the duplicate trigger
Migration: `DROP TRIGGER IF EXISTS trg_ugc_translate_projects ON public.projects;` (keep `trg_enqueue_ugc_translations`). Add a CI guard `scripts/ci/check-no-duplicate-triggers.mjs` that fails if any table has two triggers wired to the same function on the same event.

### C. Reuse the helper across other admin editors
Extract `withBoundedSave` to `src/lib/data/bounded-save.ts` and adopt in the two other admin write paths that have the same shape:
- `ProjectOpeningDetailPage` opening edits
- `ClientsPage` client edits
Documents the pattern in `docs/runbooks/admin-edit-bounded-save.md`.

### D. Observability
- New ops_events kind `admin.project.save.indeterminate` (warn) + `admin.project.save.indeterminate_resolved` (info|warn) via `record_event`.
- Triage stays gated on severity `error`, so warns don't flood the queue but show on the System Health → Performance tab if they spike.

### E. Guard rails
- New vitest: `src/test/pages/project-form.bounded-save.contract.test.ts` covering: success, hard error, timeout-then-persisted, timeout-then-mismatch.
- BDD `ADMIN-PROJECT-SAVE-001..005` in `bdd_scenarios` (tri-layer [UI]/[DB]/[Code]).
- ESLint rule `auth-invariants/no-unbounded-table-mutation` (warn) flagging `supabase.from(<admin table>).update(...)` without `withBoundedSave` in `src/pages/Admin*` and `src/pages/Project*`.

## Out of scope
- Backend infra (Cloud↔Postgres flapping) — not in app code.
- No RLS, schema, or auth changes.
- The other (non-admin) project-detail timeout in `public-project-detail` is a separate read-path issue and stays out of this shipment.

## Files
```text
src/pages/ProjectFormPage.tsx                                  (edit — bounded save + resolve-indeterminate, live status)
src/pages/ProjectOpeningDetailPage.tsx                         (edit — adopt withBoundedSave)
src/pages/ClientsPage.tsx                                      (edit — adopt withBoundedSave)
src/lib/data/bounded-save.ts                                   (new — withBoundedSave + SaveIndeterminateError + resolve probe contract)
src/lib/data/__tests__/bounded-save.test.ts                    (new)
src/test/pages/project-form.bounded-save.contract.test.ts      (new)
scripts/ci/check-no-duplicate-triggers.mjs                     (new — CI guard)
scripts/lint/eslint-plugin-auth-invariants.mjs                 (edit — no-unbounded-table-mutation rule)
docs/runbooks/admin-edit-bounded-save.md                       (new)
supabase/migrations/<ts>_drop_duplicate_projects_ugc_trigger.sql (new)
public.bdd_scenarios                                           (data — ADMIN-PROJECT-SAVE-001..005)
public.ops_events kinds                                        (data — admin.project.save.indeterminate[_resolved])
```
