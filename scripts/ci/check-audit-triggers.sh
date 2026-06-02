#!/usr/bin/env bash
# Asserts the permanent DB backstop triggers exist and are enabled.
# Layer 7 of triage noise suppression — see mem://features/triage-noise-suppression.
# Failing this script means a migration silently dropped the only enforcement
# point that survives client/edge refactors; do NOT merge until restored.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
migration_blob="$(cat "${repo_root}"/supabase/migrations/*.sql)"
migration_compact="$(tr '\n\t\r' '   ' <<<"${migration_blob}" | sed -E 's/[[:space:]]+/ /g')"

missing=0

assert_migration_contains() {
  local pattern="$1"
  local label="$2"
  if ! grep -Eiq -- "${pattern}" <<<"${migration_compact}"; then
    echo "MISSING migration invariant: ${label}" >&2
    missing=1
  else
    echo "OK migration: ${label}"
  fi
}

assert_migration_fixed() {
  local needle="$1"
  local label="$2"
  if ! grep -Fq -- "${needle}" <<<"${migration_blob}"; then
    echo "MISSING migration invariant: ${label}" >&2
    missing=1
  else
    echo "OK migration: ${label}"
  fi
}

assert_migration_contains "create[[:space:]]+or[[:space:]]+replace[[:space:]]+function[[:space:]]+public\.reject_opaque_script_error\(" "public.reject_opaque_script_error()"
assert_migration_fixed "'^(error:\s*)?script error\.?$'" "opaque Script error first-line predicate"
assert_migration_contains "create[[:space:]]+trigger[[:space:]]+trg_audit_log_reject_opaque_script_error[[:space:]]+before[[:space:]]+insert[[:space:]]+on[[:space:]]+public\.audit_log" "audit_log BEFORE INSERT trigger"
assert_migration_contains "create[[:space:]]+trigger[[:space:]]+trg_agent_fix_queue_reject_opaque_script_error[[:space:]]+before[[:space:]]+insert[[:space:]]+on[[:space:]]+public\.agent_fix_queue" "agent_fix_queue BEFORE INSERT trigger"

if grep -Eiq "disable[[:space:]]+trigger[[:space:]]+(trg_audit_log_reject_opaque_script_error|trg_agent_fix_queue_reject_opaque_script_error)" <<<"${migration_blob}"; then
  echo "DISABLED trigger found in migrations" >&2
  missing=1
fi

if [[ -z "${PGHOST:-}" ]]; then
  echo "PGHOST not set; live trigger check skipped after migration invariant check."
  exit "${missing}"
fi

required_triggers=(
  "trg_audit_log_reject_opaque_script_error"
  "trg_agent_fix_queue_reject_opaque_script_error"
)

for trg in "${required_triggers[@]}"; do
  count=$(psql -tAc "SELECT count(*) FROM pg_trigger WHERE tgname = '${trg}' AND NOT tgisinternal AND tgenabled <> 'D';")
  if [[ "${count}" -lt 1 ]]; then
    echo "MISSING or DISABLED live trigger: ${trg}" >&2
    missing=1
  else
    echo "OK live: ${trg}"
  fi
done

fn_count=$(psql -tAc "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='reject_opaque_script_error';")
if [[ "${fn_count}" -lt 1 ]]; then
  echo "MISSING live function: public.reject_opaque_script_error" >&2
  missing=1
fi

exit "${missing}"
