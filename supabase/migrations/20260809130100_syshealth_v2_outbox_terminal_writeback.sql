-- Wave 1a · v2 → email_send_log terminal write-back (root-cause fix).
--
-- The v2 pipeline records send outcomes in `email_outbox.status` but never wrote
-- them back to the legacy `email_send_log` that System Health reads and the
-- reconciler scans. Result: every v2 email sat at `pending` in email_send_log
-- forever → inflated "Stuck pending" card, and the reconciler mislabeled 327
-- already-sent messages as "lost" (2026-08-09 incident).
--
-- Fix: an AFTER-UPDATE trigger on `email_outbox`. When a row transitions into a
-- terminal status, append the matching terminal row to `email_send_log` (keyed
-- by message_id) so the legacy log becomes truthful for v2 mail. Idempotent
-- (NOT EXISTS guard); respects the partial-unique "one provider-sent row per
-- message_id" index (sent rows carry NULL error_message). SECURITY DEFINER so it
-- can write regardless of the caller's role. Trigger scope is narrow (only fires
-- WHEN new.status is terminal), so overhead on the hot path is minimal.

CREATE OR REPLACE FUNCTION public.tg_email_outbox_terminal_to_send_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
BEGIN
  -- Map outbox terminal status → email_send_log status vocabulary.
  v_status := CASE NEW.status
    WHEN 'sent'       THEN 'sent'
    WHEN 'suppressed' THEN 'suppressed'
    WHEN 'dlq'        THEN 'dlq'
    WHEN 'expired'    THEN 'failed'
    ELSE NULL
  END;
  IF v_status IS NULL OR NEW.message_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Only act on an actual transition INTO the terminal state.
  IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  -- Idempotent: never append a second terminal row of the same status for this
  -- message_id (also keeps the partial-unique idx_email_send_log_message_sent_*
  -- happy for the 'sent' case, which requires error_message IS NULL).
  IF NOT EXISTS (
    SELECT 1 FROM public.email_send_log
    WHERE message_id = NEW.message_id AND status = v_status
  ) THEN
    INSERT INTO public.email_send_log(
      message_id, template_name, recipient_email, status, error_message, metadata
    )
    VALUES (
      NEW.message_id,
      NEW.template,
      NEW.recipient,
      v_status,
      CASE WHEN v_status = 'sent' THEN NULL ELSE NULLIF(NEW.last_error, '') END,
      jsonb_build_object('source', 'email_outbox_v2', 'outbox_id', NEW.id, 'lane', NEW.lane)
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_email_outbox_terminal_to_send_log ON public.email_outbox;
CREATE TRIGGER trg_email_outbox_terminal_to_send_log
  AFTER UPDATE OF status ON public.email_outbox
  FOR EACH ROW
  WHEN (NEW.status IN ('sent', 'dlq', 'suppressed', 'expired'))
  EXECUTE FUNCTION public.tg_email_outbox_terminal_to_send_log();

COMMENT ON FUNCTION public.tg_email_outbox_terminal_to_send_log() IS
  'Wave 1a (20260809130100): mirrors v2 email_outbox terminal outcomes into the legacy email_send_log so System Health + the reconciler see the truth. Idempotent per (message_id,status).';
