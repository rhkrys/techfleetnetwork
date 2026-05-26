-- Drop the broken policy using AND instead of OR
DROP POLICY IF EXISTS "blast_recipients_admin_coord_select" ON public.project_blast_recipients;

-- Recreate with correct OR logic so admins OR coordinators can read
CREATE POLICY "blast_recipients_admin_coord_select"
  ON public.project_blast_recipients
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.project_blasts b
      JOIN public.projects p ON p.id = b.project_id
      WHERE b.id = project_blast_recipients.blast_id
        AND (
          public.has_role(auth.uid(), 'admin')
          OR p.coordinator_id = auth.uid()
        )
    )
  );