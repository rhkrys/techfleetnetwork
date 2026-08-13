-- Hand-Off Production readiness preflight. Run in the Supabase SQL editor.
-- Green/red readout: ✅ PASS / ❌ CHECK / ⚠️ MANUAL (things SQL can't see: LLM key, edge deploy).
select label,
       case when ok is null then '⚠️  MANUAL' when ok then '✅ PASS' else '❌ CHECK' end as status,
       detail
from (
  select '01. handoff_component rows (want 26)' as label,
         (select count(*) from public.spf_entity where entity_type='handoff_component' and is_active) = 26 as ok,
         'found ' || (select count(*) from public.spf_entity where entity_type='handoff_component' and is_active) as detail
  union all
  select '02. spf_entity populated (spf-sync ran)',
         (select count(*) from public.spf_entity where is_active) > 0,
         (select count(*) from public.spf_entity where is_active) || ' active rows'
  union all
  select '03. handoff-worker cron (every minute)',
         case when to_regclass('cron.job') is not null then exists(select 1 from cron.job where jobname='handoff-worker-1m') else false end,
         case when to_regclass('cron.job') is null then 'pg_cron not installed'
              else coalesce((select schedule from cron.job where jobname='handoff-worker-1m'),'MISSING') end
  union all
  select '04. prune-handoff cron (retention)',
         case when to_regclass('cron.job') is not null then exists(select 1 from cron.job where jobname='prune-handoff-productions') else false end,
         case when to_regclass('cron.job') is null then 'pg_cron not installed'
              else coalesce((select schedule from cron.job where jobname='prune-handoff-productions'),'MISSING') end
  union all
  select '05. worker vault service-role key',
         case when to_regclass('vault.decrypted_secrets') is not null
              then exists(select 1 from vault.decrypted_secrets where name in ('email_queue_service_role_key','supabase_service_role_key','service_role_key','SERVICE_ROLE_KEY'))
              else false end,
         case when to_regclass('vault.decrypted_secrets') is null then 'vault not present'
              else coalesce((select string_agg(name, ', ') from vault.decrypted_secrets where name in ('email_queue_service_role_key','supabase_service_role_key','service_role_key','SERVICE_ROLE_KEY')),'NONE — cron cannot auth') end
  union all
  select '06. hand-off tables present',
         to_regclass('public.handoff_productions') is not null
         and to_regclass('public.handoff_run_budget') is not null
         and to_regclass('public.handoff_feedback') is not null,
         'productions / budget / feedback'
  union all
  select '07. enqueue RPC present',
         to_regprocedure('public.handoff_enqueue_production(uuid,public.project_phase,uuid,text,text,text,text[],integer)') is not null,
         'handoff_enqueue_production'
  union all
  select '08. framework source = reference (safe)',
         (select active_source from public.framework_source_config where id=1) = 'reference',
         coalesce((select active_source from public.framework_source_config where id=1),'MISSING')
  union all
  select '09. LLM_API_KEY (OpenRouter)', null::boolean,
         'Edge secret — check Dashboard - Edge Functions - Secrets (cannot read from SQL)'
  union all
  select '10. Edge functions deployed', null::boolean,
         'curl the function or Dashboard - Edge Functions (cannot read from SQL)'
) t
order by label;
