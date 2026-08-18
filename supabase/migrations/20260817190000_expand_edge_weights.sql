-- Expand foundational weighting to every importance signal the SPF's own field names encode
-- (data-driven, not hand-picked): necessity (Required), ownership (Who Owns / Runs This / the
-- Workshop's Produced deliverable), distinctiveness (UNIQUE), and RACI tiering (Responsible/
-- Accountable primary; Consulted/Informed baseline). Structural "home" links get a middle weight.
-- Applied as spf_edge_map UPDATEs; a rebuild (run after) carries the weights into framework_edges.
-- Order matters: later statements override earlier so RACI tiering wins for RACI fields.

-- weight 3 — necessity: "Required Skills…", "Required Activities", "Skills Required for the Role", etc.
UPDATE public.spf_edge_map SET weight = 3 WHERE spf_field ILIKE '%required%';

-- weight 3 — ownership / primary output
UPDATE public.spf_edge_map SET weight = 3
 WHERE spf_field ILIKE '%who owns%'
    OR spf_field ILIKE '%runs this workshop%'
    OR spf_field = 'Deliverable the Workshop Produces';

-- weight 3 — distinctiveness: a milestone's UNIQUE Skills/Activities/Practices/Duties
UPDATE public.spf_edge_map SET weight = 3 WHERE spf_field ILIKE 'unique %';

-- weight 2 — the object's structural HOME / building blocks (more central than a related_to list)
UPDATE public.spf_edge_map SET weight = 2
 WHERE weight < 2 AND spf_field IN (
   'Project Milestone Where It''s Delivered',
   'What Milestone Does This Workshop Belong To?',
   'Associated Team Function',
   'Practice Components',
   'Duties in the New Field'
 );

-- RACI tiering (override) — Responsible/Accountable are the doers/owners (primary); Consulted/Informed
-- are peripheral. Keyed by rel_type (already set), so it wins regardless of the field's other words.
UPDATE public.spf_edge_map SET weight = 3 WHERE rel_type IN ('responsible', 'accountable');
UPDATE public.spf_edge_map SET weight = 1 WHERE rel_type IN ('consulted', 'informed');
