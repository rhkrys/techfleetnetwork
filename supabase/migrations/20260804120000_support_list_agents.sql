-- support_list_agents() — admin-only roster of assignable support agents.
-- Backs the "Assign to <admin>" picker in the Get Help triage grid. Returns
-- every admin's platform user_id + a display name + email so the client can
-- render a picker and send the chosen admin's UUID to freescout-proxy (which
-- verifies the target is an admin and resolves/provisions their Freescout user
-- id server-side). SECURITY DEFINER + admin gate so a non-admin can't enumerate
-- staff; pinned empty search_path (OWASP SQLi / search-path hardening).
CREATE OR REPLACE FUNCTION public.support_list_agents()
RETURNS TABLE (user_id uuid, display_name text, email text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    SELECT p.user_id,
           NULLIF(TRIM(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')), '')
             AS display_name,
           p.email
      FROM public.user_roles ur
      JOIN public.profiles p ON p.user_id = ur.user_id
     WHERE ur.role = 'admin'
       AND p.user_id IS NOT NULL
     ORDER BY 2 NULLS LAST, p.email;
END
$$;

REVOKE ALL ON FUNCTION public.support_list_agents() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.support_list_agents() TO authenticated, service_role;
