## Goal

Differentiate clients as **Internal** (Tech Fleet volunteer teams) or **External** (paying/partner clients). Internal-client projects power a fully-functional **Volunteer Openings** tab that mirrors the existing Client Project Openings experience: stats, status-chunked cards, detail page, application flow, my-applications, and dashboard surfacing.

## 1. Database

New migration:
- Add enum `public.client_kind` = `('external', 'internal')`.
- `ALTER TABLE public.clients ADD COLUMN kind public.client_kind NOT NULL DEFAULT 'external'`.
- No RLS change (already admin-managed). Project rows inherit kind via `client_id` join — no project column needed.

## 2. Clients admin (`src/components/clients/ClientsTab.tsx`)

- Add `kind` to `clientSchema`, `EMPTY_FORM`, edit dialog (Select: External / Internal) under the **Client section**.
- Show kind as a small badge in the client list/cards.
- Hide from project cards.

## 3. Projects admin

- `ProjectsTab.tsx` card + table: keep cards clean; show client kind only on the Edit page (read-only field derived from selected client) — i.e. visible "when you click into details".
- No projects-table schema change.

## 4. Project Openings page (`src/pages/ProjectOpeningsPage.tsx`)

Split enriched projects by `client.kind`:
- **Client Project Openings** tab → external clients only (today's behavior).
- **Volunteer Openings** tab → internal clients, using the **same** rendering pipeline:
  - Same stats counts (recomputed from internal subset).
  - Same status-chunked sections: Open Applications, Opening Soon, Starting Soon, Live Projects.
  - Same card view / table view toggle.
  - Same empty state styling.
- Tab badge counts use each subset's open-application count.
- Refactor the current `ResponsiveTabsContent value="client"` body into a shared `<OpeningsTabContent>` component reused by both tabs, parameterized by `{ projects, openApplications, comingSoon, startingSoon, liveProjects, emptyCopy }`.

## 5. Public openings edge function (`supabase/functions/public-project-openings/index.ts`)

- Include `kind` in the clients select.
- Return clients with kind so the client can partition.
- No filter change — both kinds returned; UI partitions.

## 6. Detail page (`src/pages/ProjectOpeningDetailPage.tsx`)

- Render a **Volunteer Opening** vs **Client Project** badge near the title using `client.kind`.
- Keep all existing detail sections; volunteer openings get the **same level of detail** (description, team hats, milestones, deliverables, timeline, apply CTA).
- Breadcrumb back-link respects which tab the user came from (query param `?from=volunteer` falls back to `client`).

## 7. Application flow

- `ProjectApplicationPage.tsx`, `MyProjectApplicationsPage.tsx`, `ProjectApplicationStatusPage.tsx`, dashboard widgets: no schema change needed — `project_applications` already references `project_id`. They will automatically work for internal-client projects.
- Add a small "Volunteer Opening" badge wherever the existing pages already show a project-type label, so applicants see the same context.

## 8. Types / services

- Regenerate `src/integrations/supabase/types.ts` after migration.
- Update local `Client` interface in `ClientsTab.tsx` and `ProjectsTab.tsx` to include `kind`.

## 9. BDD scenarios (per workspace rule)

Insert into `bdd_scenarios`:
- `VOL-OPEN-001` Internal client projects appear under Volunteer Openings tab only.
- `VOL-OPEN-002` External client projects appear under Client Project Openings tab only.
- `VOL-OPEN-003` Volunteer tab shows stats + status-chunked sections identical to Client tab.
- `VOL-OPEN-004` Detail page shows Volunteer Opening badge for internal client projects.
- `VOL-OPEN-005` User can apply to a volunteer opening and it appears in My Applications + Dashboard.
- `CLIENT-KIND-001` Admin can set client kind = Internal/External; defaults to External.
- `CLIENT-KIND-002` Kind hidden on project cards; visible on detail/edit.
Each with tri-layer [UI]/[DB]/[Code] Then-clauses.

## 10. Smoke tests

Extend `project-openings-page.smoke.test.ts` with volunteer-tab assertions; add `volunteer-openings.smoke.test.ts`.

## Out of scope

- Separate routing per kind (kept as tabs).
- Volunteer-specific application questions (uses existing form).
- Public unauth volunteer page changes beyond the partition.
