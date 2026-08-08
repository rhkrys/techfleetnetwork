-- Audit C3: support_ticket_pointers.customer_user_id had a FK to profiles(id)
-- (the random PK) while RLS filters `customer_user_id = auth.uid()` (which equals
-- profiles.user_id). Those never match, so writers could satisfy the FK OR RLS
-- but not both: drain-created tickets (written with profiles.id) satisfied the FK
-- but were invisible to the owner under RLS; eager writes (written with auth.uid)
-- FK-violated and were swallowed → duplicate tickets + dead idempotency.
--
-- Fix: standardize customer_user_id on the AUTH uid (profiles.user_id, which is
-- NOT NULL UNIQUE — a valid FK target), convert existing rows, and re-point the
-- FK. Writers are aligned in the same PR (process-freescout-events now stores
-- profiles.user_id; freescout-proxy / support-ticket.ts already used auth.uid()).
-- Idempotent + safe: no-op on a fresh CI reset (empty tables); on prod it only
-- rewrites rows that currently hold a profiles.id.

BEGIN;

-- 1. Drop the FK that targets profiles(id).
ALTER TABLE public.support_ticket_pointers
  DROP CONSTRAINT IF EXISTS support_ticket_pointers_customer_user_id_fkey;

-- 2. Convert existing values profiles.id -> profiles.user_id (drain-written rows).
UPDATE public.support_ticket_pointers p
   SET customer_user_id = pr.user_id
  FROM public.profiles pr
 WHERE p.customer_user_id = pr.id;

UPDATE public.support_ticket_events e
   SET customer_user_id = pr.user_id
  FROM public.profiles pr
 WHERE e.customer_user_id = pr.id;

-- 3. Null any value that is neither a valid user_id nor NULL (defensive, so the
--    new FK cannot violate). SET NULL is already the FK's on-delete behavior.
UPDATE public.support_ticket_pointers
   SET customer_user_id = NULL
 WHERE customer_user_id IS NOT NULL
   AND customer_user_id NOT IN (SELECT user_id FROM public.profiles);

-- 4. Re-point the FK to profiles(user_id) — the identity RLS and every writer use.
ALTER TABLE public.support_ticket_pointers
  ADD CONSTRAINT support_ticket_pointers_customer_user_id_fkey
  FOREIGN KEY (customer_user_id) REFERENCES public.profiles(user_id) ON DELETE SET NULL;

-- BDD
INSERT INTO public.bdd_scenarios
  (scenario_id, feature_area, feature_area_number, title, gherkin, status, test_type, test_file, notes)
VALUES
  ('HELP-DESK-IDENTITY-001', 'Support', 60,
   'A member sees their own ticket after both create paths and after a drained webhook',
   'Feature: consistent support ticket identity\n  Scenario: web create round-trips\n    Given a member creates a ticket via freescout-proxy\n    Then support_ticket_pointers.customer_user_id = auth.uid() (profiles.user_id)\n    And the FK to profiles(user_id) is satisfied (no swallowed 23503)\n    And the member sees it under RLS "customer_user_id = auth.uid()"\n  Scenario: inbound-email/webhook create is visible to the owner\n    Given the drain (process-freescout-events) creates a pointer for a member email\n    Then it stores profiles.user_id (not profiles.id)\n    And the owning member can see the ticket\n  Scenario: duplicate-submit idempotency works\n    Given a member submits the same subject twice within the window\n    Then the prior pointer is found (same identity key) and no duplicate ticket is created',
   'implemented', 'unit', 'src/test/smoke/support-customer-identity.smoke.test.ts',
   'C3: FK re-pointed profiles(id) -> profiles(user_id); process-freescout-events writer aligned to profiles.user_id. Full create->list round-trip is best proven by a DB-backed integration test (future); migration-smoke proves the schema change applies cleanly.')
ON CONFLICT (scenario_id) DO UPDATE SET
  title = EXCLUDED.title, gherkin = EXCLUDED.gherkin, status = EXCLUDED.status,
  test_type = EXCLUDED.test_type, test_file = EXCLUDED.test_file,
  feature_area = EXCLUDED.feature_area, feature_area_number = EXCLUDED.feature_area_number,
  notes = EXCLUDED.notes, updated_at = now();

COMMIT;
