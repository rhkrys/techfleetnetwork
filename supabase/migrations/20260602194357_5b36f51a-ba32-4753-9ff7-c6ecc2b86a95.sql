create or replace function public.reject_opaque_script_error()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  first_line text;
begin
  select btrim(line)
    into first_line
  from unnest(string_to_array(coalesce(new.error_message, ''), e'\n')) as line
  where btrim(line) <> ''
  limit 1;

  if first_line ~* '^(error:\s*)?script error\.?$' then
    return null;
  end if;
  return new;
end
$$;

drop trigger if exists trg_audit_log_reject_opaque_script_error on public.audit_log;
create trigger trg_audit_log_reject_opaque_script_error
before insert on public.audit_log
for each row execute function public.reject_opaque_script_error();

drop trigger if exists trg_agent_fix_queue_reject_opaque_script_error on public.agent_fix_queue;
create trigger trg_agent_fix_queue_reject_opaque_script_error
before insert on public.agent_fix_queue
for each row execute function public.reject_opaque_script_error();

update public.agent_fix_queue
   set status = 'resolved',
       resolved_at = coalesce(resolved_at, now()),
       dismissed_reason = coalesce(dismissed_reason, '') ||
         case when coalesce(dismissed_reason,'') = '' then '' else e'\n' end ||
         '[auto] opaque cross-origin Script error — closed by permanent DB backstop'
 where status <> 'resolved'
   and error_message ~* '^(error:\s*)?script error\.?(\n|$)';

update public.known_issue_catalog
   set reason = 'Opaque cross-origin "Script error." — enforced by BEFORE INSERT triggers reject_opaque_script_error on audit_log and agent_fix_queue. JS filter (isOpaqueScriptErrorMessage) is an early-drop optimization only.'
 where pattern = 'Script error.';
