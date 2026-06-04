# Permanent fix: eliminate OUT-param/column ambiguity in plpgsql RETURNS TABLE functions

## What happened

`get_refactor_kpis(p_days)` declares OUT columns named `metric_key`, `current_value`, `trend`, etc. — the exact same names as columns in `refactor_kpi_daily` / `refactor_kpi_catalog`. Inside `RETURN QUERY`, Postgres can't tell whether `metric_key` refers to the OUT parameter (a plpgsql variable) or a table column, so it raises `column reference "metric_key" is ambiguous`. Last turn's hotfix added `#variable_conflict use_column` to that single function. That stops the bleeding but doesn't prevent the next function from shipping the same bug.

## Goal

Make this class of bug structurally impossible: any new or edited SECURITY DEFINER / RETURNS TABLE plpgsql function must either prefix-namespace its OUT columns OR opt into `#variable_conflict use_column`, and CI must fail otherwise.

## Plan

### 1. Audit + fix every existing offender

- Query `pg_proc` for all `public.*` plpgsql functions where `RETURNS TABLE` OUT-column names overlap with any column in tables referenced in the function body.
- For each hit, apply the same one-line fix: insert `#variable_conflict use_column` at the top of the function body.
- Ship as a single SQL migration `fix_plpgsql_column_ambiguity.sql`.

Likely candidates to inspect first (same pattern — RETURNS TABLE with column-style names): `get_refactor_kpis` (done), `get_member_country_distribution`, `get_email_lane_status`, `get_triage_summary`, `discover_audit_fingerprints`, `get_web_vitals_summary`, plus any `*_summary` / `*_dashboard` RPC.

### 2. CI guard: forbid silent re-introduction

Add `scripts/ci/check-plpgsql-variable-conflict.mjs` to the existing `quality` job. It:
- Walks `supabase/migrations/**/*.sql`.
- Parses every `CREATE OR REPLACE FUNCTION ... RETURNS TABLE (...) LANGUAGE plpgsql ... AS $$ ... $$`.
- Fails the build if the body references any OUT-column name unqualified **and** the body does NOT contain `#variable_conflict use_column`.
- Allow-list escape hatch: a `-- @safe-variable-conflict` comment immediately above the function for cases where the author proves there's no shadowing.

### 3. Author convention (memory + lint message)

- Add a Core memory line: *"Every plpgsql `RETURNS TABLE` function must start with `#variable_conflict use_column` OR rename OUT params with an `o_` prefix. Enforced by `scripts/ci/check-plpgsql-variable-conflict.mjs`."*
- Make the CI failure message actionable, e.g. `Function get_foo: OUT column 'metric_key' shadows a referenced table column. Add '#variable_conflict use_column' as the first line of the function body.`

### 4. Runtime safety net (defense in depth)

- In `src/integrations/supabase` client error handling (or the shared `auditedInvoke` wrapper), tag any Postgres error matching `/column reference ".+" is ambiguous/i` as `severity:"error"` with fingerprint `pg.column_ambiguous:<fn_name>` so a regression instantly surfaces in System Health → Triage with the offending function in the title.

### 5. BDD coverage

Add scenarios `KPI-DASH-030..032`:
- KPI-DASH-030 — admin loads Refactor KPIs and sees rows (no error toast). [UI][DB][Code]
- KPI-DASH-031 — `select get_refactor_kpis(30)` returns >0 rows in DB. [DB]
- KPI-DASH-032 — CI guard fails when a new function with shadowing OUT param lands without the directive. [Code]

### 6. Memory update

- Replace the existing **Refactor KPIs Dashboard** memory note with one extra sentence noting the `#variable_conflict use_column` requirement.
- New memory entry **plpgsql OUT-param Shadowing Guard** under `mem://constraints/plpgsql-variable-conflict`.

## Files touched

- 1 migration (audit + fix all current offenders)
- `scripts/ci/check-plpgsql-variable-conflict.mjs` (new)
- `.github/workflows/*.yml` quality job (wire in the new check)
- `src/lib/errors/*` or `auditedInvoke` (add ambiguous-column tag)
- `bdd_scenarios` rows (3 new)
- `mem://index.md` + `mem://constraints/plpgsql-variable-conflict.md`

## Out of scope

- Renaming OUT params project-wide (purely cosmetic; the directive is sufficient and less churn).
- Changes to the React UI — `RefactorKPIsTab.tsx` already handles the success path; once the RPC stops throwing, the dashboard loads.
