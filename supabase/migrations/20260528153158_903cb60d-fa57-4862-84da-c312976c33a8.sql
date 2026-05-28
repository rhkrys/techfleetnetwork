GRANT USAGE ON SCHEMA public, extensions TO supabase_read_only_user;
GRANT EXECUTE ON FUNCTION public.digest(text, text) TO supabase_read_only_user;
GRANT EXECUTE ON FUNCTION public.digest(bytea, text) TO supabase_read_only_user;
GRANT EXECUTE ON FUNCTION extensions.digest(text, text) TO supabase_read_only_user;
GRANT EXECUTE ON FUNCTION extensions.digest(bytea, text) TO supabase_read_only_user;