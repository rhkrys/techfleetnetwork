-- PR 7 (email rearchitecture): admin "this is not marketing" attestation for announcement email.
--
-- Announcements are Tier-1 SERVICE email and now reach every member with notify_opportunities on
-- (~1200), not the old ~163. To keep marketing OUT of this channel (marketing goes through Email
-- Octopus per ADR-0017), the admin must attest, per send, that the announcement is a service/platform
-- update and not marketing. The send edge function refuses to email an un-attested announcement and
-- records who attested + when here (server-verified; the client cannot set these).
ALTER TABLE public.announcements
  ADD COLUMN IF NOT EXISTS marketing_attested_at timestamptz,
  ADD COLUMN IF NOT EXISTS marketing_attested_by uuid REFERENCES auth.users (id) ON DELETE SET NULL;

COMMENT ON COLUMN public.announcements.marketing_attested_at IS
  'When an admin attested (at send time) that this announcement is a service/platform update, not '
  'marketing. Set by send-announcement-email; required before the email blast is enqueued.';
COMMENT ON COLUMN public.announcements.marketing_attested_by IS
  'The admin (auth.users.id) who made the not-marketing attestation, recorded server-side.';
