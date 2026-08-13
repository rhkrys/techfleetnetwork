-- SPF data layer: GRAPH READ FACADE (ADR-0003). Part of the EXPAND step.
-- Makes framework_entity_v source-switchable between the OLD reference_* union and the NEW
-- spf_entity snapshot, driven by framework_source_config.active_source (default 'reference').
-- When 'reference' this view reproduces the prior behavior verbatim (the reference branch is
-- the exact prior definition; the spf branch returns 0 rows). Rollback = flip the flag. The
-- resolver (fw_resolve_entity), neighbors MV, and get_node(s)_neighbors all read THROUGH this
-- view, so this single facade switches the entity read + edge-resolution path.
-- (framework_search_mv names reference_* directly and is repointed in a follow-up migration.)
--
-- framework_active_source(): SECURITY DEFINER so the security_invoker view can read the flag
-- even for anon/authenticated (framework_source_config is admin-RLS'd; a direct read in the
-- view would blank it for non-admins). The flag value is non-sensitive.
CREATE OR REPLACE FUNCTION public.framework_active_source()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS
$fn$ SELECT active_source FROM public.framework_source_config WHERE id = 1 $fn$;
REVOKE ALL ON FUNCTION public.framework_active_source() FROM public;
GRANT EXECUTE ON FUNCTION public.framework_active_source() TO anon, authenticated, service_role;

CREATE OR REPLACE VIEW public.framework_entity_v WITH (security_invoker = true) AS
SELECT ref.* FROM (
 SELECT 'activity'::text AS entity_type,
    reference_activities.id,
    reference_activities.slug,
    reference_activities.name,
    reference_activities.description,
    reference_activities.category,
    reference_activities.data,
    reference_activities.is_active,
    reference_activities.updated_at
   FROM reference_activities
UNION ALL
 SELECT 'agile_method'::text AS entity_type,
    reference_agile_methods.id,
    reference_agile_methods.slug,
    reference_agile_methods.name,
    reference_agile_methods.description,
    reference_agile_methods.category,
    reference_agile_methods.data,
    reference_agile_methods.is_active,
    reference_agile_methods.updated_at
   FROM reference_agile_methods
UNION ALL
 SELECT 'company_type'::text AS entity_type,
    reference_company_types.id,
    reference_company_types.slug,
    reference_company_types.name,
    reference_company_types.description,
    reference_company_types.category,
    reference_company_types.data,
    reference_company_types.is_active,
    reference_company_types.updated_at
   FROM reference_company_types
UNION ALL
 SELECT 'deliverable'::text AS entity_type,
    reference_deliverables.id,
    reference_deliverables.slug,
    reference_deliverables.name,
    reference_deliverables.description,
    reference_deliverables.category,
    reference_deliverables.data,
    reference_deliverables.is_active,
    reference_deliverables.updated_at
   FROM reference_deliverables
UNION ALL
 SELECT 'duty'::text AS entity_type,
    reference_duties.id,
    reference_duties.slug,
    reference_duties.name,
    reference_duties.description,
    reference_duties.category,
    reference_duties.data,
    reference_duties.is_active,
    reference_duties.updated_at
   FROM reference_duties
UNION ALL
 SELECT 'job_function'::text AS entity_type,
    reference_job_functions.id,
    reference_job_functions.slug,
    reference_job_functions.name,
    reference_job_functions.description,
    reference_job_functions.category,
    reference_job_functions.data,
    reference_job_functions.is_active,
    reference_job_functions.updated_at
   FROM reference_job_functions
UNION ALL
 SELECT 'job_industry'::text AS entity_type,
    reference_job_industries.id,
    reference_job_industries.slug,
    reference_job_industries.name,
    reference_job_industries.description,
    reference_job_industries.category,
    reference_job_industries.data,
    reference_job_industries.is_active,
    reference_job_industries.updated_at
   FROM reference_job_industries
UNION ALL
 SELECT 'job_specialization'::text AS entity_type,
    reference_job_specializations.id,
    reference_job_specializations.slug,
    reference_job_specializations.name,
    reference_job_specializations.description,
    reference_job_specializations.category,
    reference_job_specializations.data,
    reference_job_specializations.is_active,
    reference_job_specializations.updated_at
   FROM reference_job_specializations
UNION ALL
 SELECT 'job_title'::text AS entity_type,
    reference_job_titles.id,
    reference_job_titles.slug,
    reference_job_titles.name,
    reference_job_titles.description,
    reference_job_titles.category,
    reference_job_titles.data,
    reference_job_titles.is_active,
    reference_job_titles.updated_at
   FROM reference_job_titles
UNION ALL
 SELECT 'practice'::text AS entity_type,
    reference_practices.id,
    reference_practices.slug,
    reference_practices.name,
    reference_practices.description,
    reference_practices.category,
    reference_practices.data,
    reference_practices.is_active,
    reference_practices.updated_at
   FROM reference_practices
UNION ALL
 SELECT 'project_milestone'::text AS entity_type,
    reference_project_milestones.id,
    reference_project_milestones.slug,
    reference_project_milestones.name,
    reference_project_milestones.description,
    reference_project_milestones.category,
    reference_project_milestones.data,
    reference_project_milestones.is_active,
    reference_project_milestones.updated_at
   FROM reference_project_milestones
UNION ALL
 SELECT 'project'::text AS entity_type,
    reference_projects.id,
    reference_projects.slug,
    reference_projects.name,
    reference_projects.description,
    reference_projects.category,
    reference_projects.data,
    reference_projects.is_active,
    reference_projects.updated_at
   FROM reference_projects
UNION ALL
 SELECT 'resource'::text AS entity_type,
    reference_resources.id,
    reference_resources.slug,
    reference_resources.name,
    reference_resources.description,
    reference_resources.category,
    reference_resources.data,
    reference_resources.is_active,
    reference_resources.updated_at
   FROM reference_resources
UNION ALL
 SELECT 'skill'::text AS entity_type,
    reference_skills.id,
    reference_skills.slug,
    reference_skills.name,
    reference_skills.description,
    reference_skills.category,
    reference_skills.data,
    reference_skills.is_active,
    reference_skills.updated_at
   FROM reference_skills
UNION ALL
 SELECT 'stakeholder'::text AS entity_type,
    reference_stakeholders.id,
    reference_stakeholders.slug,
    reference_stakeholders.name,
    reference_stakeholders.description,
    reference_stakeholders.category,
    reference_stakeholders.data,
    reference_stakeholders.is_active,
    reference_stakeholders.updated_at
   FROM reference_stakeholders
UNION ALL
 SELECT 'tech_job_category'::text AS entity_type,
    reference_tech_job_categories.id,
    reference_tech_job_categories.slug,
    reference_tech_job_categories.name,
    reference_tech_job_categories.description,
    reference_tech_job_categories.category,
    reference_tech_job_categories.data,
    reference_tech_job_categories.is_active,
    reference_tech_job_categories.updated_at
   FROM reference_tech_job_categories
UNION ALL
 SELECT 'tool'::text AS entity_type,
    reference_tools.id,
    reference_tools.slug,
    reference_tools.name,
    reference_tools.description,
    reference_tools.category,
    reference_tools.data,
    reference_tools.is_active,
    reference_tools.updated_at
   FROM reference_tools
UNION ALL
 SELECT 'workshop'::text AS entity_type,
    reference_workshops.id,
    reference_workshops.slug,
    reference_workshops.name,
    reference_workshops.description,
    reference_workshops.category,
    reference_workshops.data,
    reference_workshops.is_active,
    reference_workshops.updated_at
   FROM reference_workshops
) ref
WHERE public.framework_active_source() = 'reference'
UNION ALL
SELECT
  spf_entity.entity_type,
  spf_entity.id,
  spf_entity.slug,
  spf_entity.name,
  spf_entity.description,
  spf_entity.category,
  spf_entity.data,
  spf_entity.is_active,
  spf_entity.updated_at
FROM public.spf_entity
WHERE public.framework_active_source() = 'spf' AND spf_entity.is_active;

GRANT SELECT ON public.framework_entity_v TO authenticated, anon;
