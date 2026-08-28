# ADR 0020 — Migration-applied verification (committed migrations must be live on prod)

- Status: Accepted
- Date: 2026-08-27
- Deciders: TechFleet (owner)
- Related: `.github/workflows/migration-applied.yml`, `scripts/ci/check-migrations-applied.mjs`, `migration-smoke` + `check-migration-version-collision.mjs` (sibling migration guards), `config-preflight.yml` (same Management-API skip pattern), ADR-0012 (the frontend equivalent — "did the merged commit actually reach prod?"), the Discord-linking PGRST202 outage. First item of the Phase 0 hardening plan (`docs/architecture/audit-2026-08/`).

## Context

TFN's DB migrations are **hand-applied** (`supabase db push` run by a human), while edge functions and the frontend **auto-deploy** on merge. CI already has two migration guards, but both answer the wrong question for this failure mode:

- `check-migration-version-collision.mjs` — no two migrations share a version prefix.
- `migration-smoke` (blocking) — runs `supabase db reset` against a **fresh local Postgres**, proving the migrations apply **from scratch**.

Neither asks whether a committed migration is **actually applied to production right now**. So a migration can be committed, pass migration-smoke, merge — and then silently never reach prod because the human forgot to `db push`. That exact gap caused the **Discord-linking PGRST202 outage** (migration `20260809161000` committed but never applied): the edge function that auto-deployed called an RPC that did not exist in prod. This is the DB-schema twin of the silent-stale-frontend-deploy that ADR-0012 closed for the bundle.

## Decision

Add a **read-only** verification gate — `scripts/ci/check-migrations-applied.mjs`, run by `.github/workflows/migration-applied.yml`:

- It reads the version prefix of every `supabase/migrations/<version>_*.sql`, then reads the versions applied to prod from `supabase_migrations.schema_migrations` via the **Supabase Management-API SQL endpoint** (`POST /v1/projects/{ref}/database/query`) — the same `SUPABASE_ACCESS_TOKEN` + project ref already used by `config-preflight.yml`. **No DB password, no direct connection string, and it never writes to prod.**
- It reports two kinds of drift: **UNAPPLIED** (committed but not on prod — the outage risk) and **EXTRA** (on prod but not in the repo — ad-hoc SQL / squashed history).
- Runs on a **daily schedule**, on **`workflow_dispatch`**, and on **push to `main`** touching `supabase/migrations/**` (an immediate "remember to `db push`" nudge after a migration merges).

This is **Stage 1** (verification) of a staged plan. **Stage 2** (a future ADR) auto-applies migrations on merge — same pattern as `deploy-edge-functions.yml` — but only after two prerequisites this stage deliberately does not assume: (a) `SUPABASE_ACCESS_TOKEN` confirmed present, and (b) the prod migration history reconciled with the repo (the **EXTRA** signal above must be clean first — you cannot safely auto-`db push` onto a drifted history).

## Rollout

Mirrors ADR-0009's "ratchet + observe, then block":

- **No token set → skips green** with a `::notice::` (self-heals the moment the secret is added), exactly like `config-preflight`'s guard. Merging this is safe with or without the secret.
- **Drift, observe window (default) → `::warning::`**, workflow stays green. This lets us watch real drift for a cycle without wedging `main` red.
- **Drift, enforcing → `::error::` + red**, at which point the existing "Main failure alert" workflow pages Discord. Enforce is toggled by a repo **Actions variable** `MIGRATION_APPLIED_ENFORCE` (`"1"` to enforce) — like ADR-0012's `PROD_URL`, no code edit needed. Flip it once the current backlog of unapplied migrations is cleared and the EXTRA set is reconciled.

Two guardrails keep enforce mode from re-creating alert fatigue:
- **`push`-to-`main` runs are always observe-only.** A migration is applied by a human *after* merge, so the just-merged version is always momentarily "unapplied"; hard-failing on it would turn every migration merge red by design. Only the daily schedule / manual dispatch honor the enforce variable — they carry the real "you forgot to `db push`" signal the next morning.
- **Reachability failures never hard-fail.** An API 5xx/429/timeout/bad-token is not drift and `db push` cannot fix it, so the script retries transient failures then, if still unverifiable, emits a warning and exits 0 even in enforce mode. Only a *successful* query that shows unapplied migrations can fail the build.

## Consequences

- A forgotten `db push` becomes a **visible, dated signal** (warning now, red + Discord page once enforcing) instead of a latent outage discovered by users — the DB twin of ADR-0012 for the frontend.
- **Zero prod risk to adopt:** read-only, and a no-op until the token exists. No new secret is required to merge.
- The **EXTRA** (prod-ahead-of-repo) signal doubles as the reconciliation checklist that must be clean before Stage 2 auto-apply is safe.
- Operator actions: (one-time) confirm `SUPABASE_ACCESS_TOKEN` is set for this project; (per cycle, during the observe window) clear reported UNAPPLIED migrations with `supabase db push`; then flip `ENFORCE` to `"1"`.
- Trade-off: the check reads prod migration state through the Management API on a schedule; it does not detect *within-migration* partial application (a migration row present but its statements half-run) — that remains migration-smoke's and pgTAP's domain.
