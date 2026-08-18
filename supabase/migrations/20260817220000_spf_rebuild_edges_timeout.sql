-- Sustainability: the full edge rebuild (68k+ edges via CROSS JOIN LATERAL over spf_entity x
-- spf_edge_map) can exceed the default statement_timeout on smaller compute — it was cancelled during
-- the 2-core resize. Give the rebuild function its OWN generous timeout so any caller (edge function,
-- PostgREST, or a manual pg session) gets the leash without having to SET it per-session. ALTER SET
-- attaches the config to the function without redefining its body.
ALTER FUNCTION public.spf_rebuild_edges() SET statement_timeout = '900s';
