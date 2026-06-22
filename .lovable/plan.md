## Goal
Add four optional rich-text fields without touching any existing functionality, and unlock cohort editing (which currently has no UI at all). Refactor only where it pays for itself: a shared RichTextSection wrapper, a shared transient-retry helper, and a real edit mode for `CohortFormPage`. No RLS, no status-transition, no slug, no sanitizer-base function changes.

## What's actually broken / missing today (evidence)

- `cohorts` table has no `schedule` column; `classes` has no `curriculum`, `reading_assignments`, `class_expectations`.
- `App.tsx` only mounts `CohortFormPage` at `/teach/classes/:id/cohorts/new`. There is **no** edit route, and `CohortFormPage` only calls `CohortService.create` — that's why "a user cannot edit the cohort." RLS already permits teachers to edit `draft`/`pending_review` cohorts and admins to edit any, so the gap is purely UI/service.
- The four new fields are HTML bodies. `classes` already has a `BEFORE INSERT/UPDATE` trigger `sanitize_classes_html` that runs `sanitize_user_html` on the existing HTML columns. `cohorts` has no equivalent trigger.

## Architecture decisions (enterprise-grade, minimal blast radius)

1. **Storage = text NOT NULL DEFAULT ''** for all four new columns. Optional in the UI but never nullable in the DB → eliminates a class of "is it null or empty?" branches in services, the public detail page, and downstream consumers. Existing rows back-fill to `''` automatically, so the requirement *"existing classes/cohorts should not pre-populate but allow going back to update"* is satisfied without any data migration.
2. **Sanitization at the boundary, not in app code.** Extend the existing `sanitize_classes_html` trigger to cover the three new class columns; add a symmetrical `sanitize_cohorts_html` trigger for `cohorts.schedule`. App code never has to remember to sanitize, and a future direct SQL writer can't bypass it.
3. **RLS unchanged.** The existing policies already do exactly what we want — teachers edit only their own drafts/pending; admins edit any. We are NOT widening published-cohort edits; that's a status-transition concern (already enforced by `classes_validate_transition`-style logic for classes) and out of scope.
4. **Validators extend, never replace.** Add three optional `safeHtmlSchema` fields to `classFormSchema`, one to `cohortFormSchema`, each with `.default("")`. Zero impact on existing forms, callers, or types beyond the additive fields.
5. **One shared write-retry helper.** The transient-retry wrapper now lives privately inside `class.service.ts` (shipped earlier today). Promote it to `src/lib/db/retry.ts` (`retryTransientWrite`) and reuse it in `CohortService.create` + `CohortService.update`. Single behavior, one place to test.
6. **One shared `<RichTextSection>` presenter.** `ClassFormPage` repeats the same `<div><Label/><RichTextEditor/><error/></div>` block six times today and will hit nine. Extract a tiny presentational component `src/components/forms/RichTextSection.tsx` (label, placeholder, value, onChange, error, required?). Pure refactor; identical DOM; no behavior change. Used by class form (9 sections) and cohort form (1 section).
7. **CohortFormPage = create + edit, mirroring ClassFormPage's proven pattern.** Add `cohortId` param branch, `useCohortById` hook, `useAutosave` for edit mode gated by status `draft|pending_review`, server draft only in create mode, RichTextSection for `schedule`. Route added at `/teach/classes/:id/cohorts/:cohortId/edit`. Admins reach the same page via the existing admin classes UI.
8. **Read surfaces.** `ClassDetailPage` and the public class detail render each new section only when non-empty (`v && v.trim()`), each as a semantic `<section aria-labelledby>` with sanitized HTML via the existing `dangerouslySetInnerHTML` pattern already used for `summary`/`description`. No new XSS surface — output was sanitized at write time by the trigger.
9. **Backward compatibility.** Every existing call site that constructs a `ClassFormValues`/`CohortFormValues` continues to compile because the new fields default to `""`. The new columns are NOT NULL with `DEFAULT ''`, so the existing INSERT payloads omit them harmlessly.

## What I will build (in this order)

### A. Migration (single file)
- `ALTER TABLE public.classes ADD COLUMN curriculum text NOT NULL DEFAULT '', ADD COLUMN reading_assignments text NOT NULL DEFAULT '', ADD COLUMN class_expectations text NOT NULL DEFAULT ''`.
- `ALTER TABLE public.cohorts ADD COLUMN schedule text NOT NULL DEFAULT ''`.
- `CREATE OR REPLACE FUNCTION sanitize_classes_html()` — same body, now also sanitizes the three new columns.
- `CREATE FUNCTION sanitize_cohorts_html() RETURNS trigger ... SECURITY DEFINER` — sanitizes `NEW.schedule`.
- `CREATE TRIGGER trg_sanitize_cohorts_html BEFORE INSERT OR UPDATE ON public.cohorts FOR EACH ROW EXECUTE FUNCTION sanitize_cohorts_html()`.
- No GRANTs needed (no new tables). No RLS touched. No data backfill (defaults handle it).

### B. Code
- `src/lib/db/retry.ts` (new) — promote `retryTransient` from `class.service.ts`; re-export from `class.service.ts` for compatibility.
- `src/lib/validators/class.ts` — add 3 fields.
- `src/lib/validators/cohort.ts` — add `schedule` field.
- `src/services/class.service.ts` — extend insert + update payloads with the 3 fields (additive); import retry from new location.
- `src/services/cohort.service.ts` — extend payloads with `schedule`; wrap `create` + `update` in `retryTransientWrite`; replace `.single()` with `.maybeSingle()` + explicit "not created" error (same pattern as classes).
- `src/components/forms/RichTextSection.tsx` (new) — extracted presenter.
- `src/pages/ClassFormPage.tsx` — replace 6 existing repeated blocks with `<RichTextSection>` (pure refactor) and add 3 new sections: Curriculum, Reading Assignments, Class Expectations.
- `src/pages/CohortFormPage.tsx` — refactor to support edit mode (mirrors `ClassFormPage` create/edit branching); add Schedule section.
- `src/hooks/use-cohorts.ts` — add `useCohortById(id)`.
- `src/App.tsx` — register `/teach/classes/:id/cohorts/:cohortId/edit` route under `TeacherRoute` (admins already wrapped via `requireTeacherOrAdmin` inside `TeacherRoute`; if not, add `AdminRoute` parallel — confirmed during implementation).
- `src/pages/ClassDetailPage.tsx` (+ public detail edge fn consumer if it has a UI mirror) — render new sections conditionally.
- "Edit cohort" link added to the cohort row on the class detail page (teacher view) so users can find the new edit page.

### C. Tests
- `src/test/validators/class.test.ts` — new fields accept HTML, default to `""`, max-length boundary respected.
- `src/test/validators/cohort.test.ts` — `schedule` optional, default `""`, max-length boundary.
- `src/test/services/cohort.service.test.ts` — retry on PGRST002, no retry on 42501, maybeSingle handling.
- `src/test/lib/db-retry.test.ts` — exercises the shared helper directly.

### D. BDD scenarios (DB, tri-layer)
- `CLASS-EDIT-EXT-001` — New class fields are optional and persist as sanitized HTML.
- `CLASS-EDIT-EXT-002` — Existing classes show empty new sections and can be edited to add them.
- `CLASS-EDIT-EXT-003` — Cohort edit route opens, shows existing values, saves with retry resilience.
- `CLASS-EDIT-EXT-004` — Cohort `schedule` is optional and sanitized by trigger (verified by inserting `<script>` via service-role and reading back without it).
- `CLASS-EDIT-EXT-005` — Teacher cannot edit a published cohort (RLS unchanged); admin can.
- `CLASS-EDIT-EXT-006` — Read pages render each new section only when non-empty.

## Out of scope (explicitly)

- No changes to RLS, status transitions, slug generation, sanitizer base function, courses/lessons, cohort registration flow, email templates, admin approval workflow, autosave engine, or draft engine.
- No widening of who can edit a published cohort.
- No new tables, no new edge functions, no new buckets, no new auth surfaces.

## Files touched

```text
supabase/migrations/<new>.sql                       (new   — additive columns + triggers)
src/lib/db/retry.ts                                 (new   — shared retry helper)
src/lib/validators/class.ts                         (edit  — +3 optional HTML fields)
src/lib/validators/cohort.ts                        (edit  — +schedule)
src/services/class.service.ts                       (edit  — payload extension; import retry)
src/services/cohort.service.ts                      (edit  — payload + retry + maybeSingle)
src/hooks/use-cohorts.ts                            (edit  — +useCohortById)
src/components/forms/RichTextSection.tsx            (new   — extracted presenter)
src/pages/ClassFormPage.tsx                         (edit  — refactor + 3 new sections)
src/pages/CohortFormPage.tsx                        (edit  — create+edit, +schedule)
src/pages/ClassDetailPage.tsx                       (edit  — render new sections)
src/App.tsx                                         (edit  — add cohort edit route)
src/test/validators/class.test.ts                   (edit)
src/test/validators/cohort.test.ts                  (new/edit)
src/test/services/cohort.service.test.ts            (new)
src/test/lib/db-retry.test.ts                       (new)
public.bdd_scenarios                                (data  — CLASS-EDIT-EXT-001..006)
```

This is purely additive at the data + RLS layer, and at the UI layer it's an isolated section block per form plus a new edit route. The only refactor is the RichTextSection extraction and promoting the already-tested retry helper to a shared module — both reduce code, not add it.