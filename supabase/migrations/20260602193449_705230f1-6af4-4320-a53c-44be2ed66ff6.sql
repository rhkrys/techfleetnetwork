INSERT INTO public.bdd_scenarios (scenario_id, feature_area, feature_area_number, title, gherkin, status, test_type, notes)
VALUES
  (
    'HELP-DESK-040',
    'Help Desk',
    7,
    'Newly created ticket appears in My tickets',
    'Scenario: New ticket shows up in My tickets immediately
  Given I am signed in as a member with a Freescout customer record
  When I create a new ticket from Get Help
  Then [UI] the ticket appears in the "My tickets" list on the next render
  And [Code] freescout-proxy create sends customer.id when available so Freescout links the conversation to my stored customer id
  And [Code] useTickets uses refetchOnMount:"always" so the list revalidates on tab focus
  And [DB] support_ticket_pointers has a row with my user_id and the new conversation_id',
    'not_built',
    'none',
    'Get Help ticket visibility regression coverage'
  ),
  (
    'HELP-DESK-041',
    'Help Desk',
    7,
    'Newly created ticket appears in admin All tickets',
    'Scenario: Admin sees new ticket after switching tabs
  Given I am signed in as an admin
  And a member just created a ticket
  When I open the "All tickets" admin tab
  Then [UI] the new ticket is visible in the AG Grid
  And [Code] the create handler calls invalidateAll() on the edge isolate cache
  And [Code] NewTicketDialog.onCreated invalidates the broad ["support"] query key
  And [DB] support_ticket_pointers contains the new conversation_id for later ownership checks',
    'not_built',
    'none',
    'Get Help admin ticket visibility regression coverage'
  ),
  (
    'HELP-DESK-042',
    'Help Desk',
    7,
    'Admin tab bar exposes Open unassigned and Open assigned as top-level tabs',
    'Scenario: Admin can filter open tickets by assignment from the top tab bar
  Given I am signed in as an admin on Get Help
  Then [UI] the tab bar shows "My tickets", "Open · unassigned", "Open · assigned", "All tickets", and "Reports"
  When I click "Open · unassigned"
  Then [UI] only open tickets with no assignee are listed
  When I click "Open · assigned"
  Then [UI] only open tickets with an assignee are listed
  And [Code] AdminAllTicketsGrid accepts a fixed scope prop that hides its internal sub-tabs
  And [DB] no new data is created; the view reads Freescout conversation assignment state through the existing proxy',
    'not_built',
    'none',
    'Get Help admin tab structure regression coverage'
  )
ON CONFLICT (scenario_id) DO UPDATE
SET
  feature_area = EXCLUDED.feature_area,
  feature_area_number = EXCLUDED.feature_area_number,
  title = EXCLUDED.title,
  gherkin = EXCLUDED.gherkin,
  status = EXCLUDED.status,
  test_type = EXCLUDED.test_type,
  notes = EXCLUDED.notes,
  updated_at = now();