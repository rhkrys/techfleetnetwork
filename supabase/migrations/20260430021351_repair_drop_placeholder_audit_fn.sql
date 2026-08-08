-- REPAIR (audit H3, cont.): remove the temporary stub created in
-- 20260430021349 to satisfy the erroneous placeholder REVOKE in
-- 20260430021350 (`public.your_audit_function_name()`). Runs immediately after
-- that REVOKE so the function exists exactly long enough to be REVOKE'd, then
-- the schema is left clean. No-op on any DB where the stub isn't present.
DROP FUNCTION IF EXISTS public.your_audit_function_name();
