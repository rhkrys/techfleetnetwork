## Goal

Help admins gauge applicant preparation by surfacing which Core and Basic (onboarding) courses each applicant has completed — and which are still missing — both on the Recruiting Center project roster table and on the single-applicant review page.

## What admins will see

**Header:** "Completed courses" with a count chip like `5 / 8`.

**Pills:**
- Completed courses → solid Growth Green pill with checkmark + course name
- Not-yet-completed courses → outlined muted pill with course name (visibly de-emphasized, no icon)

Courses are grouped under two sub-labels: **Core courses** (6 total) and **Basic courses** (2 total: First Steps Onboarding, Connect Discord). Pills sort by `display_order` within each group so the layout is stable.

## Where it appears

1. **Project roster table** (`/admin/roster/project/:projectId`)
   - New column "Courses prepared" showing compact count `5 / 8` as a clickable badge.
   - Hover/click opens a popover with the full pill layout (header + Core/Basic groups).
   - Sortable by completion count so admins can rank candidates by preparation.

2. **Applicant review page** (`/admin/roster/project/:projectId/applicant/:applicationId`)
   - New "Completed courses" Card placed directly under the existing applicant identity section, above the project-specific application answers.
   - Full pill layout, no popover — everything visible at a glance.

## Data

- Source: `course_completions` (already RLS-allows admins) joined to `course_catalog` (filtered to `active = true` AND `tier IN ('core','onboarding')`).
- Course list reference is loaded once per page via a single `course_catalog` query.
- Per-applicant completions:
  - **Roster table:** one batched query `course_completions.select(user_id, course_key).in('user_id', userIds)` — built into a `Map<user_id, Set<course_key>>` so each row renders without an extra round-trip.
  - **Applicant review page:** single `course_completions.select(course_key, completed_at).eq('user_id', app.user_id)` query.

No schema changes, no new RPC, no edge function.

## Technical notes

- New presentational component `src/components/admin/CompletedCoursesPanel.tsx` reused on both surfaces. Props: `completedKeys: Set<string>`, `catalog: { core: CatalogRow[]; onboarding: CatalogRow[] }`, `variant: "full" | "compact"`.
- New hook `src/hooks/use-course-catalog-prep.ts` returns the cached core+onboarding catalog (5-min staleTime) so both surfaces share it.
- Roster table column uses an AG Grid `cellRenderer` that renders the count badge inside a shadcn `Popover` (keyboard-accessible, focus-trap handled by Radix). Sort comparator uses completion count; AG Grid `valueGetter` returns the integer count.
- Pills built with the existing shadcn `Badge` component using semantic HSL tokens — no raw hex. Completed = `bg-[hsl(var(--success))]`-style token already mapped to Growth Green; missing = `variant="outline"` with `text-muted-foreground`.
- ARIA: popover trigger has `aria-label="View completed courses for {name}"`; pill groups use `role="list"` with `aria-labelledby` pointing at the group heading; missing pills get `aria-label="{course name} — not completed"` so screen readers don't just read the name.
- Card surface uses `<Card>` so the global `tf-card` retrofit applies automatically; brand voice copy ("Completed courses", "Core courses", "Basic courses") is sentence case.

## BDD scenarios (stored in `bdd_scenarios`)

- `REC-PREP-001` — Roster column shows `X / 8` reflecting Core + Basic completions [UI/DB/Code]
- `REC-PREP-002` — Popover lists completed pills (green, checkmark) and missing pills (outlined) grouped under Core / Basic headings, sorted by `display_order` [UI/Code]
- `REC-PREP-003` — Applicant review page renders the same panel inline (no popover) above project answers [UI/Code]
- `REC-PREP-004` — Sorting the roster column orders applicants by completion count desc/asc [UI/Code]
- `REC-PREP-005` — Non-admin viewing the page cannot fetch `course_completions` for other users (RLS holds) [DB]
- `REC-PREP-006` — When `course_catalog` has zero active core+onboarding rows, panel renders an empty state ("No required courses configured") instead of `0 / 0` [UI/Code]

## Out of scope

- No badge/certificate display (badges remain on their own surfaces).
- No filtering or saved-views on the roster grid beyond the new sortable column.
- Project / advanced tier courses are intentionally excluded per your scope ("Core and Basic only").
