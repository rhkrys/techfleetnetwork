## Problem

The "Share Feedback" card on the dashboard is a hardcoded widget (`use-dashboard-preferences.ts:17`, `DashboardPage.tsx:351–361`) that:

- Ships **enabled by default** for every user (`DEFAULT_VISIBLE` includes it).
- Sits at **position 2** in `DEFAULT_ORDER`, directly under the welcome header.
- Is just a one-line link with no progress/data — so it visually outweighs Core Courses and the completion card next to it.
- Duplicates feedback entry points that already exist in the global nav, footer, and Fleety chat widget.

## Fix

Remove Share Feedback as a dashboard widget entirely. Keep `/feedback` and all other feedback entry points untouched.

### Changes

1. **`src/hooks/use-dashboard-preferences.ts`**
   - Remove `"feedback"` from the `DashboardWidgetId` union.
   - Remove the `{ id: "feedback", label: "Share Feedback" }` entry from `ALL_WIDGETS`.
   - (DEFAULT_ORDER / DEFAULT_VISIBLE derive from `ALL_WIDGETS`, so they update automatically.)
   - The existing `extractWidgetList` validator filters unknown IDs via `VALID_WIDGET_IDS`, so any user whose persisted `visible_widgets` / `widget_order` still contains `"feedback"` will have it transparently dropped on load — no migration required, no errors.

2. **`src/pages/DashboardPage.tsx`**
   - Delete the `case "feedback":` block in the widget switch (lines 351–361).
   - Remove the now-unused `Link` import only if no other usage remains (verify before deleting).

3. **No DB migration.** `dashboard_preferences.visible_widgets` / `widget_order` are JSON arrays; orphan `"feedback"` strings are silently ignored by the loader and will be overwritten the next time the user toggles or reorders any widget.

### Out of scope

- `/feedback` page, `FeedbackService`, feedback nav links, footer links, Fleety widget — all untouched.
- Other widgets (Core Courses, Badges, Network Activity, etc.) — no changes.
- DashboardCustomizer — automatically reflects the updated `ALL_WIDGETS` list.

### BDD (added to `bdd_scenarios`)

- `DASH-FEEDBACK-001` — Given any signed-in member, When the dashboard renders, Then no "Share Feedback" card appears [UI] AND `dashboard_preferences.visible_widgets` returned from the loader does not include `"feedback"` [DB] AND `ALL_WIDGETS` exported from `use-dashboard-preferences` contains no entry with `id === "feedback"` [Code].
- `DASH-FEEDBACK-002` — Given a user whose stored `visible_widgets` JSON still contains the legacy `"feedback"` string, When the dashboard loads, Then the page renders without error and the legacy value is filtered out by `extractWidgetList` [Code/UI].
- `DASH-FEEDBACK-003` — Given the DashboardCustomizer sheet is opened, Then "Share Feedback" is not offered as a toggleable widget [UI].
