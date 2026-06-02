#!/usr/bin/env bash
# Asserts the permanent DB backstop triggers exist and are enabled.
# Layer 7 of triage noise suppression — see mem://features/triage-noise-suppression.
# Failing this script means a migration silently dropped the only enforcement
# point that survives client/edge refactors; do NOT merge until restored.
set -euo pipefail

: "${PGHOST:?PGHOST required}"

required_triggers=(
  "trg_audit_log_reject_opaque_script_error"
  "trg_agent_fix_queue_reject_opaque_script_error"
)

missing=0
for trg in "${required_triggers[@]}"; do
  count=$(psql -tAc "SELECT count(*) FROM pg_trigger WHERE tgname = '${trg}' AND NOT tgisinternal AND tgenabled <> 'D';")
  if [[ "${count}" -lt 1 ]]; then
    echo "MISSING or DISABLED trigger: ${trg}" >&2
    missing=1
  else
    echo "OK: ${trg}"
  fi
done

fn_count=$(psql -tAc "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='reject_opaque_script_error';")
if [[ "${fn_count}" -lt 1 ]]; then
  echo "MISSING function: public.reject_opaque_script_error" >&2
  missing=1
fi

exit "${missing}"
