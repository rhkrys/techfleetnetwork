-- pgTAP suite for audit H9 — GDPR erasure propagation to the email + Gumroad
-- PII sinks, the erasure-completes fix (self-referential cascade re-delete), and
-- the raw-payload retention prune.
BEGIN;
SELECT plan(9);

-- ── Fixtures: user A, erased via the real path (delete auth.users) ───────────
INSERT INTO auth.users (id, email)
VALUES ('a1111111-1111-1111-1111-111111111111', 'erase-me@example.com')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.profiles (user_id, email, display_name)
VALUES ('a1111111-1111-1111-1111-111111111111', 'erase-me@example.com', 'Erase Me')
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO public.email_send_log (message_id, template_name, recipient_email, status, metadata)
VALUES ('h9-msg-1', 'welcome', 'erase-me@example.com', 'sent',
        jsonb_build_object('idempotency_key', 'k1', 'queue_name', 'transactional_emails'));

INSERT INTO public.gumroad_sales
  (sale_id, email, resolved_user_id, status, raw_payload)
VALUES ('h9-sale-1', 'erase-me@example.com', 'a1111111-1111-1111-1111-111111111111', 'processed',
        jsonb_build_object('email', 'erase-me@example.com', 'full_name', 'Erase Me', 'ip', '1.2.3.4'));

-- Preconditions
SELECT is(
  (SELECT count(*)::int FROM public.email_send_log WHERE lower(recipient_email) = 'erase-me@example.com'),
  1, 'precondition: an email_send_log row exists for the user');
SELECT isnt(
  (SELECT raw_payload FROM public.gumroad_sales WHERE sale_id = 'h9-sale-1'),
  '{}'::jsonb, 'precondition: gumroad raw_payload is populated');

-- ── Act: delete the auth user (the ONLY production erasure entrypoint) ────────
DELETE FROM auth.users WHERE id = 'a1111111-1111-1111-1111-111111111111';

-- ── Assert erasure COMPLETES (re-entrancy fix) and propagates ────────────────
SELECT is(
  (SELECT count(*)::int FROM auth.users WHERE id = 'a1111111-1111-1111-1111-111111111111'),
  0, 'H9: deleting auth.users completes (no self-referential cascade rollback)');
SELECT is(
  (SELECT count(*)::int FROM public.email_send_log WHERE lower(recipient_email) = 'erase-me@example.com'),
  0, 'H9: email_send_log rows for the erased user are deleted');
SELECT is(
  (SELECT email FROM public.gumroad_sales WHERE sale_id = 'h9-sale-1'),
  'erased@gdpr.invalid', 'H9: gumroad_sales email is redacted on erasure');
SELECT is(
  (SELECT raw_payload FROM public.gumroad_sales WHERE sale_id = 'h9-sale-1'),
  '{}'::jsonb, 'H9: gumroad_sales raw_payload is dropped on erasure');

-- ── User B: direct profile delete still cascades to auth.users (flag unset) ───
INSERT INTO auth.users (id, email)
VALUES ('b2222222-2222-2222-2222-222222222222', 'cascade-me@example.com')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.profiles (user_id, email, display_name)
VALUES ('b2222222-2222-2222-2222-222222222222', 'cascade-me@example.com', 'Cascade Me')
ON CONFLICT (user_id) DO NOTHING;

DELETE FROM public.profiles WHERE user_id = 'b2222222-2222-2222-2222-222222222222';

SELECT is(
  (SELECT count(*)::int FROM auth.users WHERE id = 'b2222222-2222-2222-2222-222222222222'),
  0, 'H9: a direct profile delete still cascades to remove the auth.users row');

-- ── Retention prune: redacts aged raw payloads, keeps recent ones ────────────
INSERT INTO public.gumroad_sales (sale_id, email, status, raw_payload, received_at)
VALUES
  ('h9-old', 'old@example.com', 'processed', jsonb_build_object('x', 1), now() - interval '200 days'),
  ('h9-new', 'new@example.com', 'processed', jsonb_build_object('y', 2), now());

SELECT public.prune_gumroad_raw_payloads();

SELECT is(
  (SELECT raw_payload FROM public.gumroad_sales WHERE sale_id = 'h9-old'),
  '{}'::jsonb, 'H9: prune redacts raw_payload older than 180 days');
SELECT isnt(
  (SELECT raw_payload FROM public.gumroad_sales WHERE sale_id = 'h9-new'),
  '{}'::jsonb, 'H9: prune leaves recent raw_payload intact');

SELECT * FROM finish();
ROLLBACK;
