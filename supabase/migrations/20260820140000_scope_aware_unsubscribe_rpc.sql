-- PR 4b (email rearchitecture): scope-aware unsubscribe for the platform's Tier-1 service email.
--
-- The one-click unsubscribe on the platform's "Opportunities and platform updates" (Tier 1) email
-- must set the per-scope opt-out, NOT a global suppressed_emails row. Global suppression is checked
-- on EVERY lane including auth (enqueue-email.ts:32, transactional-email.ts:459), so unsubscribing
-- via the old code stopped critical account email too (password resets, interview invites) — the
-- ADR-0018 violation. This RPC is the correct action: it only turns off the Tier-1 opt-out.
--
-- Dual-write `notify_announcements = false` during the expand phase, because the Tier-1 senders
-- still read that flag until PR 5 re-gates them onto notify_opportunities. Case-insensitive email
-- match. Marketing unsubscribes are NOT handled here — Email Octopus owns those (ADR-0017).

CREATE OR REPLACE FUNCTION public.set_email_opportunities_unsubscribed(p_email text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.profiles
     SET notify_opportunities = false,
         notify_announcements  = false  -- expand-phase dual-write (senders read this until PR 5)
   WHERE lower(email) = lower(p_email);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

-- Called by the public unsubscribe edge function via the service-role admin client. The token is
-- the authorization; the endpoint resolves the email from the single-use token.
REVOKE ALL ON FUNCTION public.set_email_opportunities_unsubscribed(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_email_opportunities_unsubscribed(text) TO service_role;

COMMENT ON FUNCTION public.set_email_opportunities_unsubscribed(text) IS
  'Scope-aware Tier-1 unsubscribe: turns off notify_opportunities (+ notify_announcements during the '
  'expand phase) for the given email. NEVER writes suppressed_emails. Marketing unsubscribes are '
  'handled by Email Octopus, not the platform (ADR-0017).';
