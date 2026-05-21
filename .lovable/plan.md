# Autosave for creation/edit forms

Add a unified, 30-second-interval autosave to the five long forms so members and admins never lose work. One shared hook + one shared status pill, wired into each form.

## Forms in scope

| Form | File | Today |
|---|---|---|
| General Application | `src/hooks/use-general-application.tsx` + `GeneralApplicationTab.tsx` | Manual "Save draft" button only |
| Project Phase Application | `src/pages/ProjectApplicationPage.tsx` | Manual draft mutation |
| Project (admin create/edit) | `src/pages/ProjectFormPage.tsx` | Create + update mutations, no draft persistence |
| Client (admin create/edit) | `src/components/clients/ClientsTab.tsx` (dialog) | Create + update mutations only |
| Course / Class creation | `src/pages/ClassFormPage.tsx` | Manual "Create draft" / "Save changes" only |

Note: there is no standalone "Course form" — Tech Fleet's course-creation surface is the Class form (`ClassFormPage`). The inline AG-Grid editor in `admin/CurriculumAdminPage.tsx` already saves per cell and is out of scope.

## What members see

- Autosave fires **every 30 seconds** while the form is dirty (single fixed interval — no per-keystroke debounce), and also flushes on tab hide and on route change.
- A small status pill — `Saved · just now` / `Saving…` / `Unsaved changes` / `Save failed — retry` — sits **inline in the form footer, immediately to the left of the "Save draft" button** (left-aligned within the same row, not a floating toast).
- Uses semantic tokens, `aria-live="polite"`, relative-time label via `src/lib/format/date.ts`. No top-center toast for autosave events (avoids 30-second toast spam).
- Manual "Save draft" / "Submit" buttons remain — autosave never submits, only persists drafts.
- Submitted/approved records are not autosaved (read-only state preserved).
- `beforeunload` warning fires only while a save is in flight or the form is dirty within the 30s window.

## Architecture

### New shared pieces

1. `src/hooks/use-autosave.ts` — generic hook:
   - Inputs: `value`, `enabled`, `intervalMs` (default **30_000**), `onSave(value)`, `equals?`
   - Tracks: `status: 'idle' | 'dirty' | 'saving' | 'saved' | 'error'`, `lastSavedAt`, `error`
   - Marks `dirty` on any change; a single `setInterval(30_000)` checks "dirty && !saving" and flushes
   - Coalesces in-flight saves (queues latest value, drops superseded ones)
   - Flush-on-hide via `visibilitychange === hidden` and `pagehide`; flush on unmount
   - `beforeunload` guard while `dirty` or `saving`
   - Exponential backoff on failure (1s/3s/8s, max 3 retries) then surfaces `error` with manual retry button on the pill
2. `src/components/ui/AutosaveStatus.tsx` — inline pill placed left of the Save draft button in each form footer.

### Per-form wiring

- **General Application**: call `useAutosave` inside `use-general-application.tsx` against `form`, `enabled = activeApp && status !== 'submitted'`, `onSave = (v) => GeneralApplicationService.save(activeApp.id, v)`. Mount `<AutosaveStatus />` in the sticky footer of `GeneralApplicationTab.tsx`, in the same flex row as "Save Draft", on its left.
- **Project Application**: extract draft-mutation body into `saveDraft(values)`; feed flattened state to `useAutosave`. Pill sits left of the Save Draft button in the existing sticky footer.
- **Project Form**: autosave updates only when editing an existing project. For new project, defer autosave until first manual "Create" (no orphan rows). Pill sits left of the primary action.
- **Client dialog**: same — autosave only when editing an existing client; new-client dialog stays manual. Pill in `DialogFooter`, left of "Save".
- **Class Form**: autosave both create and edit. For create, after the first successful autosave we have a draft `id`; subsequent saves switch to update. Never autosaves once `status` is `pending_review` or beyond. Pill sits left of "Save changes" / "Create draft" in the existing footer row.

### Reliability + security

- All saves go through existing services which already use `assertWritten`, RLS, sanitization, circuit breakers.
- No new tables; uses existing `status='draft'` semantics.
- Reuses `reportError` for failed autosaves; >3 consecutive failures emit a triage event.
- Shallow-equal guard so a tick with no real change does not hit Supabase.
- Single 30s interval per form (not per field) keeps backend load minimal at scale.

### BDD

`AUTOSAVE-001..010` covering: 30s cadence [Code], persisted row after tick [DB], no save on submitted/approved [Code], retry/backoff on transient failure [Code], beforeunload guard [UI], pill positioned left of Save draft [UI], no autosave for new Project/Client until first manual save [DB], flush-on-hide [Code], no toast spam [UI], status pill `aria-live` polite [UI].

### Out of scope

- Curriculum inline AG-Grid editor (already per-cell).
- Cohort form (can adopt the hook later).
- Multi-tab conflict resolution — last-write-wins.

## Files touched

- New: `src/hooks/use-autosave.ts`, `src/components/ui/AutosaveStatus.tsx`, tests under `src/test/hooks/`.
- Edited: `use-general-application.tsx`, `GeneralApplicationTab.tsx`, `ProjectApplicationPage.tsx`, `ProjectFormPage.tsx`, `clients/ClientsTab.tsx`, `ClassFormPage.tsx`.
- BDD: insert rows into `bdd_scenarios`.
