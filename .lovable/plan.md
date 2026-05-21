# Fix "Other Project" placeholder in Recruiting Center

## What's actually wrong

The "Also applied to" chip on the Recruiting Center applicant card resolves project names through a query that **only fetches projects with `project_status = 'apply_now'`**. Today that filter matches just 1 of your 4 active projects, so any cross-project reference to the other 3 (recruiting / team_onboarding phases) silently degrades to the literal string `"Other Project"`.

Verified against the database:

| Project | Status | Completed apps |
|---|---|---|
| Tech Fleet Professional Association | team_onboarding | 32 |
| Free Dog Trainers | recruiting | 15 |
| Global Eco Village | apply_now | 13 |
| aTypical Community | recruiting | 12 |

Only Global Eco Village survives the `apply_now` filter, so the other three render as "Other Project". This is **not** leftover purged test data — every project_id has a real, current row in `projects` with a valid `clients.name`.

## Fix

In `src/components/admin/ProjectAnalysisContent.tsx`:

1. **Widen the lookup query** (`applyNowProjects`, lines 199–210):
   - Drop the `.eq("project_status", "apply_now")` filter.
   - Rename the variable + queryKey to `crossProjectLookup` / `analysis-cross-project-lookup` to remove the misleading "apply_now" framing.
   - Keep the same selected columns (`id, project_type, phase, client_id, clients(name)`); add `project_status` so future UI can disambiguate.
   - Update the dependency array on the `useMemo` at line 279 accordingly.

2. **Tighten the fallback** on line 269: change `"Other Project"` to `"Unknown project"` so any genuinely orphaned application (e.g., a hard-deleted project) shows an honest label instead of a name that looks like a real project. This makes future regressions immediately recognizable.

3. **Make the chip behavior consistent** — the chip becomes a `<Link>` to `/admin/roster/project/{projectId}` only when the project was resolved; orphaned rows render as plain text (no link). The current code already passes `projectId`, so the only change is conditionally suppressing the link when `clientName === "Unknown project"`.

## Verification

- After the change, reload Recruiting Center → David Dovhan's card. The chip should read **"Tech Fleet Professional Association"** (or whichever other real project he also applied to), not "Other Project".
- Spot-check 2–3 other multi-project applicants in the same view.
- DB-level sanity: `SELECT COUNT(*) FROM project_applications pa LEFT JOIN projects p ON p.id = pa.project_id WHERE p.id IS NULL;` should be `0`, confirming there are no truly orphaned applications and therefore no card should ever fall back to "Unknown project" today.

## BDD scenarios to add to `bdd_scenarios`

- **REC-CROSSPROJ-001** — Cross-project chip shows the real client name regardless of project_status [UI/DB/Code]
- **REC-CROSSPROJ-002** — Cross-project chip falls back to "Unknown project" (not "Other Project") only when the referenced `projects.id` no longer exists [UI/DB/Code]
- **REC-CROSSPROJ-003** — Cross-project chip is a clickable link to `/admin/roster/project/{id}` when resolved, plain text when unresolved [UI/Code]

## Out of scope

- No schema changes, no migration.
- No change to how applications themselves are queried.
- No change to the Recruiting Center grid or applicant detail page beyond this chip.
