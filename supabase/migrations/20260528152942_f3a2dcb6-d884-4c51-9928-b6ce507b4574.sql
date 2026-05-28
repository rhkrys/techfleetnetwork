-- Permanent compatibility wrapper for legacy/unqualified digest(...) calls.
-- pgcrypto lives in the extensions schema in Lovable Cloud. Older functions or dynamic SQL
-- may resolve digest(...) against public-only search paths, which raises SQLSTATE 42883.
CREATE OR REPLACE FUNCTION public.digest(data text, type text)
RETURNS bytea
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path = extensions
AS $$
  SELECT extensions.digest(data, type);
$$;

CREATE OR REPLACE FUNCTION public.digest(data bytea, type text)
RETURNS bytea
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path = extensions
AS $$
  SELECT extensions.digest(data, type);
$$;

REVOKE ALL ON FUNCTION public.digest(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.digest(bytea, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.digest(text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.digest(bytea, text) TO authenticated, service_role;

INSERT INTO public.bdd_scenarios (
  feature_area,
  feature_area_number,
  scenario_id,
  title,
  gherkin,
  status,
  test_type,
  notes
)
VALUES (
  'Backend hash compatibility',
  42883,
  'HASH-COMPAT-001',
  'Legacy digest calls resolve through the approved extensions schema',
  'Feature: Backend hash compatibility

Scenario: Legacy digest calls resolve through the approved extensions schema
  Given a backend process, trigger, or function uses digest with text or bytea input
  And the process runs with a public-only search path
  When the process computes a SHA-256 hash for audit, retention, translation, or rate-limit data
  Then [UI] The member sees the original workflow complete without a generic failure toast caused by digest resolution
  And [DB] The database resolves public.digest(text,text) and public.digest(bytea,text) to extensions.digest and returns a bytea hash without SQLSTATE 42883
  And [Code] Backend functions can safely call either qualified extensions.digest or legacy unqualified digest without changing caller payloads',
  'implemented',
  'manual',
  'Permanent guard for SQLSTATE 42883: function digest(text, unknown) does not exist.'
)
ON CONFLICT (scenario_id) DO UPDATE SET
  title = EXCLUDED.title,
  gherkin = EXCLUDED.gherkin,
  status = EXCLUDED.status,
  test_type = EXCLUDED.test_type,
  notes = EXCLUDED.notes,
  updated_at = now();