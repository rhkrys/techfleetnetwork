CREATE OR REPLACE FUNCTION public.resolve_stale_fingerprints_on_deploy(
  p_fingerprint_like text,
  p_reason text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer;
BEGIN
  IF p_fingerprint_like IS NULL OR length(p_fingerprint_like) < 4 THEN
    RAISE EXCEPTION 'p_fingerprint_like must be a non-trivial LIKE pattern';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'p_reason is required for audit trail';
  END IF;

  UPDATE public.agent_fix_queue
     SET status           = 'resolved',
         resolved_at      = now(),
         dismissed_reason = COALESCE(dismissed_reason, p_reason)
   WHERE status IN ('open', 'in_progress', 'triaged', 'pending', 'proposed')
     AND (fingerprint    ILIKE p_fingerprint_like
          OR error_message ILIKE p_fingerprint_like);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;