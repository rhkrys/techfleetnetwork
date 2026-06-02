# Get Help — ticket visibility + admin tab structure

## Root causes

**1. New tickets don't appear in "My open" or "All"**
- `freescout-proxy create` sends `customer: { email }` only. Freescout links the new conversation to whichever customer record matches that email — which may be a different ID than the one we cached in `profiles.freescout_customer_id` (e.g. created earlier with a different casing or a pre-existing record). `listMine` then filters Freescout by `customerId = stored id` and returns nothing for the just-created ticket.
- Client `useTickets` uses `staleTime: 60_000` + `refetchOnMount: false`, so switching tabs after creating does not refetch. The dialog's `onCreated` only invalidates the active scope's key (`["support","tickets","mine"]`), so the admin "All" tab stays stale even after a navigation.
- Edge isolate cache is correctly invalidated (`invalidateUser` + `invalidateAll`) on create, so this is purely a client-cache + customer-linking bug, not an edge-cache bug.

**2. Admin needs first-class "Open unassigned" and "Open assigned" tabs**
- These filters exist today but are buried inside the "Triage grid" sub-view. The top-level admin tab bar only shows: My tickets | All tickets | Triage grid | Reports.

## Changes

### `supabase/functions/freescout-proxy/index.ts`
- `create` handler: send `customer: { id: Number(cust.customerId) }` (with `email` as fallback only when no id) on both the conversation and the inner thread, so Freescout always attaches the new conversation to our stored customer id. This makes `listMine?customerId=…` find it.
- `listMine`: also pass `customerEmail: cust.email` alongside `customerId` so legacy conversations linked by email still surface even when ids drift.
- Keep existing `invalidateUser` + `invalidateAll` calls.

### `src/pages/community/GetHelpPage.tsx`
- `useTickets`: change `refetchOnMount: false` → `refetchOnMount: "always"`; keep `staleTime: 60_000` so background polling stays cheap but tab switches always revalidate.
- `NewTicketDialog.onCreated`: replace the scope-specific refresh with `qc.invalidateQueries({ queryKey: ["support"] })` so admin tabs refresh too.
- Restructure admin tab bar to:
  - **My tickets** (`<TicketList scope="mine" />`)
  - **Open · unassigned** (new `<AdminScopedList scope="open-unassigned" />`)
  - **Open · assigned** (new `<AdminScopedList scope="open-assigned" />`)
  - **All tickets** (`<AdminScopedList scope="all" />`)
  - **Reports** (`<MonthlyReportPanel />`)
- The current "Triage grid" tab is dropped — its three sub-scopes become the three top-level admin tabs, powered by the existing `AdminAllTicketsGrid` rendered with a fixed scope prop.

### `src/pages/community/AdminAllTicketsGrid.tsx`
- Accept an optional `scope?: "open-unassigned" | "open-assigned" | "all"` prop; when provided, hide the internal `<Tabs>` and use the prop directly.
- Apply the same `refetchOnMount: "always"` change to `useScopedTickets`.

### BDD
- Append migration inserting into `bdd_scenarios`:
  - `HELP-DESK-040` — Newly created ticket appears in "My tickets" on the next render.
  - `HELP-DESK-041` — Newly created ticket appears in admin "All tickets" after switching tabs.
  - `HELP-DESK-042` — Admin tab bar exposes "Open · unassigned" and "Open · assigned" as top-level tabs and each shows only matching tickets.

## Out of scope
- No edge-cache TTL changes, no schema changes, no Freescout webhook changes, no other audit/severity changes.
