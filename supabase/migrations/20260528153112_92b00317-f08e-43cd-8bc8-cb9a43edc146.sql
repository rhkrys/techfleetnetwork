GRANT EXECUTE ON FUNCTION extensions.digest(text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION extensions.digest(bytea, text) TO anon, authenticated, service_role;

DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['sandbox_exec', 'sandbox_exec_iqsjhrhsjlgjiaedzmtz'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION extensions.digest(text, text) TO %I', r);
      EXECUTE format('GRANT EXECUTE ON FUNCTION extensions.digest(bytea, text) TO %I', r);
    END IF;
  END LOOP;
END $$;