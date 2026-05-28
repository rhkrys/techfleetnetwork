-- Audit helpers are SECURITY DEFINER and called from triggers fired by
-- authenticated user actions (e.g. inserting an announcement). Without
-- EXECUTE the trigger raises "permission denied for function ..." and the
-- parent statement is rolled back. Grant minimal EXECUTE so the wrappers
-- can do their own authorization internally.
GRANT EXECUTE ON FUNCTION public.try_write_audit_log(text, text, text, uuid, text[], text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.write_audit_log(text, text, text, uuid, text[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.write_audit_log(text, text, text, uuid, text[], text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.upsert_fix_queue_entry(text, text, text, text, text, text) TO authenticated, service_role;