-- pgTAP: the Tier-1 unsubscribe sets the opt-out, never a global suppression (PR 4b, ADR-0015).
-- Run: `supabase test db` against a migrated DB. Rolled back at the end.
-- Proves set_email_opportunities_unsubscribed(): turns off notify_opportunities (+ the expand-phase
-- notify_announcements) and NEVER writes suppressed_emails, so critical account email still sends.

BEGIN;
SELECT plan(4);

INSERT INTO auth.users (id, email) VALUES
  ('11111111-1111-1111-1111-111111111111', 'unsub-pgtap@example.com')
ON CONFLICT (id) DO NOTHING;

-- Profile opted into everything; note the MIXED-CASE email to exercise the case-insensitive match.
INSERT INTO public.profiles (user_id, email, notify_opportunities, notify_announcements) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Unsub-PgTAP@Example.com', true, true)
ON CONFLICT (user_id) DO UPDATE
  SET email = 'Unsub-PgTAP@Example.com', notify_opportunities = true, notify_announcements = true;

-- Act: unsubscribe using the lowercase token email (case-insensitive match must still hit).
SELECT is(
  public.set_email_opportunities_unsubscribed('unsub-pgtap@example.com'),
  1,
  'unsubscribe updates exactly one profile (case-insensitive email match)');

SELECT is(
  (SELECT notify_opportunities FROM public.profiles
   WHERE user_id = '11111111-1111-1111-1111-111111111111'),
  false,
  'unsubscribe turns off notify_opportunities');

SELECT is(
  (SELECT notify_announcements FROM public.profiles
   WHERE user_id = '11111111-1111-1111-1111-111111111111'),
  false,
  'unsubscribe dual-writes notify_announcements = false (expand phase, senders read it until PR 5)');

SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.suppressed_emails WHERE lower(email) = 'unsub-pgtap@example.com'),
  'unsubscribe NEVER writes a global suppressed_emails row — critical account email still sends (ADR-0015)');

SELECT * FROM finish();
ROLLBACK;
