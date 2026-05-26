
DROP POLICY IF EXISTS "Admins only on admin realtime topics" ON realtime.messages;
DROP POLICY IF EXISTS "Admins only write on admin realtime topics" ON realtime.messages;

CREATE POLICY "Scoped realtime read access"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  CASE
    WHEN (realtime.topic() = ANY (ARRAY['system_health_state'::text, 'system_remediations'::text, 'system-health-live'::text, 'project-blasts-health'::text]))
         OR (realtime.topic() LIKE 'admin:%')
      THEN public.has_role(auth.uid(), 'admin'::public.app_role)
    WHEN realtime.topic() LIKE 'user:' || auth.uid()::text || ':%'
      THEN true
    WHEN position(auth.uid()::text in realtime.topic()) > 0
      THEN true
    ELSE false
  END
);

CREATE POLICY "Scoped realtime write access"
ON realtime.messages
FOR INSERT
TO authenticated
WITH CHECK (
  CASE
    WHEN (realtime.topic() = ANY (ARRAY['system_health_state'::text, 'system_remediations'::text, 'system-health-live'::text, 'project-blasts-health'::text]))
         OR (realtime.topic() LIKE 'admin:%')
      THEN public.has_role(auth.uid(), 'admin'::public.app_role)
    WHEN realtime.topic() LIKE 'user:' || auth.uid()::text || ':%'
      THEN true
    WHEN position(auth.uid()::text in realtime.topic()) > 0
      THEN true
    ELSE false
  END
);
