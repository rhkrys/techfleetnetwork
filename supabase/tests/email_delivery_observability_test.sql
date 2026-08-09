-- pgTAP suite for Wave 1 email-observability fixes (2026-08-09).
-- Run: `supabase db test` (CI-pinned CLI 2.30.4) against a migrated DB.
-- Proves: (1) v2 outbox terminal states mirror into email_send_log, (2) the
-- reconciler ignores v2 (email_outbox) messages so it stops false-DLQ'ing them,
-- (3) suppression is reversible (admin recovery path — lockout-prevention).
-- Rolled back at the end.

BEGIN;
SELECT plan(4);

-- ── 1. Write-back trigger: outbox → email_send_log terminal mirror ──────────
INSERT INTO public.email_outbox (lane, template, recipient, idempotency_key, message_id, expires_at, status)
VALUES ('bulk', 'announcement', 'wb@example.com', 'pgtap-wb-1', 'pgtap-wb-1', now() + interval '1 hour', 'pending');

UPDATE public.email_outbox SET status = 'sent' WHERE message_id = 'pgtap-wb-1';

SELECT ok(
  EXISTS (SELECT 1 FROM public.email_send_log WHERE message_id = 'pgtap-wb-1' AND status = 'sent'),
  'v2 write-back trigger mirrors email_outbox sent → email_send_log sent (root-cause fix)');

-- ── 2. Reconciler ignores v2 messages (has an email_outbox row) ─────────────
-- A stuck-pending legacy-log row that ALSO has an email_outbox row is v2-owned;
-- the reconciler must NOT dead-letter it. (Insert status='expired' directly —
-- the write-back trigger is UPDATE-only, so it does not fire on this INSERT.)
INSERT INTO public.email_send_log (message_id, template_name, recipient_email, status, created_at)
VALUES ('pgtap-v2-skip', 'announcement', 'v2skip@example.com', 'pending', now() - interval '20 minutes');
INSERT INTO public.email_outbox (lane, template, recipient, idempotency_key, message_id, expires_at, status)
VALUES ('bulk', 'announcement', 'v2skip@example.com', 'pgtap-v2-skip', 'pgtap-v2-skip', now() - interval '1 hour', 'expired');

DO $$ BEGIN PERFORM public.reconcile_stuck_emails(); END $$;

SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.email_send_log WHERE message_id = 'pgtap-v2-skip' AND status = 'dlq'),
  'reconciler ignores v2 (email_outbox) messages — no false DLQ');

-- ── 3. Control: a stuck-pending LEGACY row (no outbox) is still handled ──────
-- Guards against over-broad exclusion silently disabling the reconciler.
INSERT INTO public.email_send_log (message_id, template_name, recipient_email, status, created_at)
VALUES ('pgtap-legacy-lost', 'signup', 'legacy@example.com', 'pending', now() - interval '20 minutes');

DO $$ BEGIN PERFORM public.reconcile_stuck_emails(); END $$;

SELECT ok(
  EXISTS (SELECT 1 FROM public.email_send_log WHERE message_id = 'pgtap-legacy-lost' AND status = 'dlq'),
  'reconciler still dead-letters a genuinely-lost LEGACY message (no email_outbox row)');

-- ── 4. Suppression is reversible (lockout-prevention recovery path) ──────────
INSERT INTO public.suppressed_emails (email, reason)
VALUES ('recover@example.com', 'bounce')
ON CONFLICT (email) DO NOTHING;
DELETE FROM public.suppressed_emails WHERE email = 'recover@example.com';

SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.suppressed_emails WHERE email = 'recover@example.com'),
  'a suppressed address can be removed (admin recovery path — @lockout-prevention)');

SELECT * FROM finish();
ROLLBACK;
