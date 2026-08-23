-- PR 8 (email rearchitecture): DSAR — account deletion removes the member's Email Octopus contact.
--
-- ADR-0017: EO is the marketing source of truth, so erasure must reach EO. On account deletion we
-- enqueue a 'deleted' desired-state for the departing email; the EO worker calls EO DELETE (idempotent
-- — a 404 means already gone) and then purges the local sync row (record_eo_sync_result, updated in
-- 20260822120000) so no deleted user's email is retained locally.
--
-- Implemented as its OWN BEFORE DELETE trigger on auth.users, separate from handle_user_deletion, so
-- the sensitive erasure entrypoint is left untouched. Multiple BEFORE DELETE triggers coexist.

-- Service-role helper: mark a contact for deletion at EO. Also usable for a manual DSAR request.
CREATE OR REPLACE FUNCTION public.enqueue_eo_contact_delete(p_email text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text := lower(coalesce(p_email, ''));
BEGIN
  IF v_email = '' THEN
    RETURN;
  END IF;
  INSERT INTO public.email_octopus_contact_sync AS s
    (email, user_id, desired_status, fields, version, synced_version, status,
     attempts, next_attempt_at, last_error, last_status_code, dlq_reason, updated_at)
  VALUES
    (v_email, NULL, 'deleted', '{}'::jsonb, 1, 0, 'pending', 0, now(), NULL, NULL, NULL, now())
  ON CONFLICT (email) DO UPDATE SET
     desired_status   = 'deleted',
     user_id          = NULL,
     version          = s.version + 1,
     status           = 'pending',
     attempts         = 0,
     next_attempt_at  = now(),
     last_error       = NULL,
     last_status_code = NULL,
     dlq_reason       = NULL,
     updated_at       = now();
END;
$$;
REVOKE ALL ON FUNCTION public.enqueue_eo_contact_delete(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_eo_contact_delete(text) TO service_role;

-- BEFORE DELETE trigger on auth.users: OLD.email identifies the departing member.
CREATE OR REPLACE FUNCTION public.eo_enqueue_contact_delete_on_user_deletion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.enqueue_eo_contact_delete(OLD.email);
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS eo_enqueue_contact_delete_before_user_delete ON auth.users;
CREATE TRIGGER eo_enqueue_contact_delete_before_user_delete
  BEFORE DELETE ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.eo_enqueue_contact_delete_on_user_deletion();
