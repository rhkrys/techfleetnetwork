-- "True" relations: wherever ONE generic verb hid distinct meanings, split it into the precise
-- relation the SPF field already names — so Fleety can give concrete mentoring ("BRING your research
-- skills, START with interviewing, you'll DEVELOP synthesis") instead of five flavors of "requires".
-- Same pattern as RACI. Enum ADD VALUEs must commit before the rebuild uses them (apply script runs
-- them first). Remaps are scoped so a pattern can't catch the wrong type. Rebuild after.

-- ── new relation types ───────────────────────────────────────────────────────
ALTER TYPE public.framework_rel_type ADD VALUE IF NOT EXISTS 'foundational_skill';
ALTER TYPE public.framework_rel_type ADD VALUE IF NOT EXISTS 'first_step_skill';
ALTER TYPE public.framework_rel_type ADD VALUE IF NOT EXISTS 'transferable_skill';
ALTER TYPE public.framework_rel_type ADD VALUE IF NOT EXISTS 'develops_skill';
ALTER TYPE public.framework_rel_type ADD VALUE IF NOT EXISTS 'prerequisite_skill';
ALTER TYPE public.framework_rel_type ADD VALUE IF NOT EXISTS 'teaches_practice';
ALTER TYPE public.framework_rel_type ADD VALUE IF NOT EXISTS 'requires_practice';
ALTER TYPE public.framework_rel_type ADD VALUE IF NOT EXISTS 'applies_practice';
ALTER TYPE public.framework_rel_type ADD VALUE IF NOT EXISTS 'has_component';
ALTER TYPE public.framework_rel_type ADD VALUE IF NOT EXISTS 'learns_tool';
ALTER TYPE public.framework_rel_type ADD VALUE IF NOT EXISTS 'learns_method';
ALTER TYPE public.framework_rel_type ADD VALUE IF NOT EXISTS 'learns_deliverable';
ALTER TYPE public.framework_rel_type ADD VALUE IF NOT EXISTS 'target_duty';
ALTER TYPE public.framework_rel_type ADD VALUE IF NOT EXISTS 'delivered_in';
ALTER TYPE public.framework_rel_type ADD VALUE IF NOT EXISTS 'performed_in';
ALTER TYPE public.framework_rel_type ADD VALUE IF NOT EXISTS 'follows';

-- ── SKILLS: requires_skill hid start-here vs bring-this vs grow-this ──────────
UPDATE public.spf_edge_map SET rel_type='foundational_skill'
 WHERE dst_entity_type='skill' AND spf_field ILIKE '%foundational%';
UPDATE public.spf_edge_map SET rel_type='first_step_skill'
 WHERE dst_entity_type='skill' AND spf_field ILIKE 'first step%';
UPDATE public.spf_edge_map SET rel_type='transferable_skill'
 WHERE dst_entity_type='skill' AND spf_field ILIKE '%transfer%';
UPDATE public.spf_edge_map SET rel_type='develops_skill'
 WHERE dst_entity_type='skill' AND spf_field ILIKE 'unique skills%';
UPDATE public.spf_edge_map SET rel_type='prerequisite_skill'
 WHERE src_entity_type='skill' AND dst_entity_type='skill';

-- ── PRACTICES: uses_practice hid teach vs require vs apply; components ────────
UPDATE public.spf_edge_map SET rel_type='teaches_practice'
 WHERE spf_field='Practices That This Workshop Teaches';
UPDATE public.spf_edge_map SET rel_type='requires_practice'
 WHERE dst_entity_type='practice' AND (spf_field ILIKE '%needed%' OR spf_field ILIKE '%other practices required%');
UPDATE public.spf_edge_map SET rel_type='has_component'
 WHERE dst_entity_type='practice_component';
UPDATE public.spf_edge_map SET rel_type='applies_practice'
 WHERE dst_entity_type='practice' AND rel_type='uses_practice';

-- ── CAREER "to learn" targets: a transition is ABOUT what you learn ───────────
UPDATE public.spf_edge_map SET rel_type='learns_tool'        WHERE spf_field='Tools to Learn';
UPDATE public.spf_edge_map SET rel_type='learns_method'      WHERE spf_field='Methodologies to Learn';
UPDATE public.spf_edge_map SET rel_type='learns_deliverable' WHERE spf_field='Deliverables to Learn';
UPDATE public.spf_edge_map SET rel_type='target_duty'        WHERE spf_field='Duties in the New Field';

-- ── MILESTONES/DELIVERABLES (Tier 2): the verb was slightly wrong, not just generic ──
UPDATE public.spf_edge_map SET rel_type='delivered_in'
 WHERE src_entity_type='project_milestone' AND spf_field='All Deliverables In the Milestone';
UPDATE public.spf_edge_map SET rel_type='performed_in'
 WHERE src_entity_type='project_milestone' AND dst_entity_type='activity';
UPDATE public.spf_edge_map SET rel_type='follows'
 WHERE spf_field='Should Be Done After';
