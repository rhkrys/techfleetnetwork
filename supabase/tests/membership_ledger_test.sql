-- pgTAP suite for the Early Career Membership ledger→projection feature.
-- Run: `supabase db test` (or pg_prove) against a DB with the migrations applied.
-- Proves the SECURITY properties by actually attacking them as a member, plus
-- the projector's derivation logic. Everything runs in a rolled-back transaction.

BEGIN;
SELECT plan(18);

-- ── Fixtures ─────────────────────────────────────────────────────────────────
-- Two auth users: an attacker (member) and a victim.
INSERT INTO auth.users (id, email) VALUES
  ('11111111-1111-1111-1111-111111111111', 'member@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'victim@example.com')
ON CONFLICT (id) DO NOTHING;

-- Profiles exist (created by the app's handle_new_user in reality).
-- display_name is NOT NULL and a BEFORE INSERT trigger (auto_derive_display_name)
-- nulls out a blank value derived from empty first/last names, so it must be set.
INSERT INTO public.profiles (user_id, display_name, email) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Member', 'member@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'Victim', 'victim@example.com')
ON CONFLICT (user_id) DO NOTHING;

-- Catalog: the founding SKU is seeded by the feature migration. Add a plain
-- monthly community SKU + confirm founding exists.
INSERT INTO public.membership_products (product_id, tier, is_founding, billing_period, rank)
VALUES ('community-monthly', 'community', false, 'monthly', 50)
ON CONFLICT (product_id) DO NOTHING;

-- ── Projector logic (service-role context) ───────────────────────────────────
-- 1. A cataloged, active sale grants community.
INSERT INTO public.gumroad_sales (sale_id, email, product_id, resolved_user_id, status)
VALUES ('sale-active', 'member@example.com', 'community-monthly', '11111111-1111-1111-1111-111111111111', 'applied');
SELECT is(
  public.compute_membership('11111111-1111-1111-1111-111111111111'),
  'community'::public.membership_tier,
  'active cataloged sale grants community');

-- 2. Idempotent — running again yields the same result.
SELECT is(
  public.compute_membership('11111111-1111-1111-1111-111111111111'),
  'community'::public.membership_tier,
  'projector is idempotent');

-- 3. Refund downgrades to starter.
UPDATE public.gumroad_sales SET refunded_at = now() WHERE sale_id = 'sale-active';
SELECT is(
  public.compute_membership('11111111-1111-1111-1111-111111111111'),
  'starter'::public.membership_tier,
  'refund downgrades access to starter');

-- 4. Uncataloged product grants nothing.
INSERT INTO public.gumroad_sales (sale_id, email, product_id, resolved_user_id, status)
VALUES ('sale-other', 'member@example.com', 'some-ebook-product', '11111111-1111-1111-1111-111111111111', 'applied');
SELECT is(
  public.compute_membership('11111111-1111-1111-1111-111111111111'),
  'starter'::public.membership_tier,
  'uncataloged product grants nothing');

-- 5. Founding latch: a founding sale sets is_founding_member true...
--    The catalog is keyed on the stable product_id 'ftpql' (permalink
--    'founding-membership' is only an alias); real Gumroad payloads carry both.
--    The sale must therefore carry product_id 'ftpql' (or the permalink) for the
--    catalog lookup to resolve it as founding.
INSERT INTO public.gumroad_sales (sale_id, email, product_id, product_permalink, resolved_user_id, status)
VALUES ('sale-founding', 'member@example.com', 'ftpql', 'founding-membership', '11111111-1111-1111-1111-111111111111', 'applied');
SELECT lives_ok($$ SELECT public.compute_membership('11111111-1111-1111-1111-111111111111') $$, 'project founding member');
SELECT is(
  (SELECT is_founding_member FROM public.profiles WHERE user_id = '11111111-1111-1111-1111-111111111111'),
  true, 'founding sale sets the permanent founding latch');

-- 6. ...and cancellation does NOT revoke founding (permanent).
UPDATE public.gumroad_sales SET subscription_ended_at = now() WHERE sale_id = 'sale-founding';
SELECT lives_ok($$ SELECT public.compute_membership('11111111-1111-1111-1111-111111111111') $$, 'reproject after end');
SELECT is(
  (SELECT is_founding_member FROM public.profiles WHERE user_id = '11111111-1111-1111-1111-111111111111'),
  true, 'cancellation does not revoke founding');

-- 7. ...but a dispute (chargeback) DOES clear founding.
UPDATE public.gumroad_sales SET disputed_at = now() WHERE sale_id = 'sale-founding';
SELECT lives_ok($$ SELECT public.compute_membership('11111111-1111-1111-1111-111111111111') $$, 'reproject after dispute');
SELECT is(
  (SELECT is_founding_member FROM public.profiles WHERE user_id = '11111111-1111-1111-1111-111111111111'),
  false, 'a disputed founding sale clears the founding latch');

-- 8. Billing period is derived from the SALE's recurrence — the founding SKU
--    'ftpql' sells both monthly and yearly under one product_id.
DELETE FROM public.gumroad_sales WHERE resolved_user_id = '11111111-1111-1111-1111-111111111111';
INSERT INTO public.gumroad_sales (sale_id, email, product_id, recurrence, resolved_user_id, status)
VALUES ('sale-monthly', 'member@example.com', 'ftpql', 'monthly', '11111111-1111-1111-1111-111111111111', 'applied');
SELECT lives_ok($$ SELECT public.compute_membership('11111111-1111-1111-1111-111111111111') $$, 'project monthly founding sale');
SELECT is(
  (SELECT membership_billing_period FROM public.profiles WHERE user_id = '11111111-1111-1111-1111-111111111111'),
  'monthly', 'monthly recurrence -> monthly billing');
UPDATE public.gumroad_sales SET recurrence = 'yearly' WHERE sale_id = 'sale-monthly';
SELECT lives_ok($$ SELECT public.compute_membership('11111111-1111-1111-1111-111111111111') $$, 'reproject after switch to yearly');
SELECT is(
  (SELECT membership_billing_period FROM public.profiles WHERE user_id = '11111111-1111-1111-1111-111111111111'),
  'yearly', 'yearly recurrence -> yearly billing');

-- Reset this member to starter (clear their ledger, then re-project) so the
-- self-grant attempt below is a genuine tier CHANGE the column guard must block —
-- not a no-op UPDATE to the tier they already hold (which the guard rightly allows).
DO $$ BEGIN
  DELETE FROM public.gumroad_sales WHERE resolved_user_id = '11111111-1111-1111-1111-111111111111';
  PERFORM public.compute_membership('11111111-1111-1111-1111-111111111111');
END $$;

-- ── RLS / authorization negatives (as an authenticated member) ───────────────
SET LOCAL role authenticated;
SET LOCAL "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- 8. A member cannot INSERT a fake sale (ledger deny-by-default).
SELECT throws_ok(
  $$ INSERT INTO public.gumroad_sales (sale_id, email, product_id, resolved_user_id, status)
     VALUES ('hack', 'member@example.com', 'community-monthly', '11111111-1111-1111-1111-111111111111', 'applied') $$,
  '42501', NULL, 'member cannot insert into gumroad_sales');

-- 9. A member cannot PATCH their own membership tier (column guard).
SELECT throws_ok(
  $$ UPDATE public.profiles SET membership_tier = 'community'
      WHERE user_id = '11111111-1111-1111-1111-111111111111' $$,
  '42501', NULL, 'member cannot self-grant a paid tier');

-- 10. A non-admin cannot reattach a sale.
SELECT throws_ok(
  $$ SELECT public.attach_gumroad_sale('sale-other', '11111111-1111-1111-1111-111111111111') $$,
  '42501', NULL, 'non-admin cannot call attach_gumroad_sale');

-- 11. A member cannot call the projector directly.
SELECT throws_ok(
  $$ SELECT public.compute_membership('22222222-2222-2222-2222-222222222222') $$,
  '42501', NULL, 'member cannot invoke compute_membership');

RESET role;
SELECT * FROM finish();
ROLLBACK;
