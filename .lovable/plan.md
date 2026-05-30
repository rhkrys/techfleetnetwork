# Database-First Content Architecture Refactor

## Why
Audit of the codebase found four classes of content living on the server filesystem instead of the database:

| What | Where | Size | Read by |
|---|---|---|---|
| Tech Fleet framework CSVs (skills, deliverables, milestones, stakeholders, activities, duties, practices, team-functions, tools, agile-methods, company-types, industries, specializations, workshops, handbooks, etc.) | `public/data/*.csv` | ~20 MB across 18 files | `/admin/ingest` page fetches them client-side to populate `reference_*` tables |
| Legal policies (Terms, Terms of Use, Privacy, Cookies, Accessibility, Code of Conduct) | `public/policies/*.md` + `.docx` | ~150 KB | `TermsPage`, `PrivacyPage`, `CookiesPage`, `AccessibilityPage`, `CodeOfConductPage`, `TermsOfUsePage`, `FirstStepsPage` |
| Base i18n bundle | `src/i18n/locales/en/common.json` + `public/locales/en/common.json` (duplicated) | small but duplicated | i18next loader |
| Hard-coded framework constants | `src/lib/skills-framework.ts` (auto-generated from CSV) | static TS module | imported throughout `src/` |

The DB already has the right tables (`reference_*` × 19, `policy_versions`, `policy_acknowledgments`, `i18n_strings`, `i18n_translations`, `handbooks`) — the UI just bypasses them. This refactor makes the database the **single source of truth** for all content and turns the filesystem versions into a private, versioned source-of-record archive in Storage (admin-only), not shipped to browsers.

`localStorage` usage was also audited (theme, language, dismissals, sheet sizes, session-activity heartbeat) — all are per-device UI preferences that legitimately belong on the device, not in the DB. Durable user preferences (`preferred_language`, theme) are already mirrored to `profiles`. No change there.

## Scope — 4 phases shipped in one pass

### Phase 1 — Legal policies become DB-driven
1. Extend `policy_versions`: add `body_md text not null`, `body_html text` (server-rendered, sanitized), `title text not null`, `summary text`, `language text not null default 'en'`, `published_at timestamptz`, unique `(policy_key, version, language)`.
2. Seed migration: parse each `public/policies/*.md`, INSERT one row per policy with `version='1.0.0'`, `is_current=true`, `checksum=sha256(body_md)`. Sanitize → `body_html` with DOMPurify-equivalent server-side (Deno `npm:dompurify`).
3. New SECURITY DEFINER RPC `get_current_policy(p_key text, p_language text default 'en')` → returns the current row. Granted to `anon, authenticated`.
4. Refactor `TermsPage`, `TermsOfUsePage`, `PrivacyPage`, `CookiesPage`, `AccessibilityPage`, `CodeOfConductPage`, `LegalPolicyPanel`, `FirstStepsPage` to call `get_current_policy()` via React Query (1 day staleTime, falls back to cached version on offline). Delete the `fetch('/policies/*.md')` calls.
5. New admin route `/admin/policies` (admin-only via existing `has_role`): list versions per policy, "Publish new version" form (paste markdown → server sanitizes → bumps version → marks new row current → keeps history). Existing `policy_acknowledgments` keeps pointing at the now-canonical `policy_versions.id`.
6. Move source `.md` + `.docx` originals to private storage bucket `policy-source-archive` (admin-read only, no public access). Delete `public/policies/` from the build.

### Phase 2 — Framework CSVs become admin-only Storage + DB
1. New private storage bucket `framework-source-csv` (admin-read only). Migration uploads all 18 CSVs from `public/data/` into this bucket and deletes the public copies.
2. Refactor `/admin/ingest` (`AdminIngestPage.tsx`): instead of `fetch('/data/*.csv')`, call a new `framework-ingest` edge function that signs a download URL for the admin's session, streams the CSV from the private bucket, parses it with PapaParse, and `INSERT … ON CONFLICT` into the matching `reference_*` table inside one transaction per file. Idempotent; returns row counts.
3. Add `reference_data_sources` table tracking `(table_name, source_filename, checksum, row_count, ingested_at, ingested_by)` so System Health → Content tab shows when each table was last refreshed and from which file checksum.
4. Replace `src/lib/skills-framework.ts` (hard-coded TS) with a React-Query-backed `useFrameworkConstants()` hook reading from `reference_*` tables. Build-time fallback only for the constants the build itself needs (none currently — verified by `lsp--code_intelligence` references pass during execution).
5. Delete `public/data/` from the build pipeline. CI fails if any file reappears under `public/data/` or any `.csv > 50 KB` is committed to `src/` or `public/`.

### Phase 3 — i18n bundles become DB-driven (with offline fallback)
1. Extend `i18n_strings` usage: insert all keyed strings from `common.json` with `namespace='common'`. Each row becomes the source-of-truth English value. Insert matching `i18n_translations` rows with `locale='en', source='curated', is_admin_edited=true, status='qa_passed'`.
2. New edge function `get-i18n-bundle?locale=&namespace=&since=` returns `{ version, strings: {key: value} }` with strong ETag + `Cache-Control: public, max-age=300, stale-while-revalidate=86400`. Streams from `i18n_translations` joined to `i18n_strings`.
3. `src/i18n/index.ts` (i18next setup) switches `backend.loadPath` to call this edge function. The current `common.json` is reduced to a **minimal offline-only fallback** (just login/error strings — ~20 keys) so the app boots if the network/edge is down. New string keys added by developers are caught by a CI rail: any `t('foo.bar')` whose key is not present in `i18n_strings` fails `npm run check:i18n`.
4. Delete `public/locales/en/common.json` (duplicate). Keep the 20-key offline fallback at `src/i18n/fallback.ts` typed and code-reviewed.
5. Existing `<TranslatedContent>` and `installDomTranslator()` (memory: i18n-runtime-translator) are unchanged — they already use the DB.

### Phase 4 — Rails so this never drifts back
1. ESLint rule `no-public-content` (custom, `scripts/eslint-plugin-no-public-content.mjs`) — forbids `fetch('/policies/...')`, `fetch('/data/*.csv')`, `fetch('/locales/...')`, and imports of `.csv` / `.md` / locale `.json` from `src/`.
2. Build-time `vite-plugin-content-guard` — scans the emitted bundle and fails the build if `public/policies/`, `public/data/`, or `public/locales/` directories exist with files >0 bytes.
3. CI step `npm run check:content-architecture` runs: ESLint rule + bundle scan + a DB query asserting `policy_versions.is_current` exists for each of the 6 policy keys and each of the 19 `reference_*` tables has `> 0` rows.
4. ~25 new BDD scenarios in `bdd_scenarios` tagged `@content-db-first` with tri-layer Then-clauses ([UI]/[DB]/[Code]) covering: policy fetched from DB, policy version bump publishes new content without redeploy, ingest of changed CSV updates `reference_*` table + `reference_data_sources`, i18n bundle served from edge function with ETag, offline fallback engages when edge fails, ESLint rejects forbidden imports, build guard rejects public/data file.
5. Memory updates: new `mem://tech/data/db-first-content`, supersede `mem://features/policy-pages` (now DB-backed), update `mem://features/reference-data-tables` (CSV source moved to private bucket).

## Verification gates (run after migration)
- `SELECT count(*) FROM policy_versions WHERE is_current = true` → 6 (one per policy key)
- `SELECT table_name, count(*) FROM reference_data_sources GROUP BY 1` → 19 rows
- `SELECT count(*) FROM i18n_strings WHERE namespace='common'` → matches the curated bundle key count
- `find public/data public/policies public/locales -type f 2>/dev/null` → empty
- `npm run check:content-architecture` → exit 0
- ESLint → 0 violations on `no-public-content`
- `bdd_scenarios @content-db-first` count → ≥ 25
- Smoke test loads `/terms`, `/privacy`, `/cookies`, `/accessibility` with network blocked to `/policies/*` → all render from DB

## Technical details

**No UX regression:** All pages render the same content with the same layout; the only change is the data source. Per-version `body_html` is pre-sanitized on write so client render is a single `dangerouslySetInnerHTML` with no runtime sanitizer cost. React Query `staleTime: 24h` keeps the policies cached so navigation feels instant.

**Versioning model:** `policy_versions` becomes append-only (DELETE-blocking trigger), with `is_current` flipped via a SECURITY DEFINER `publish_policy_version(p_key, p_version, p_body_md)` RPC that transactionally unsets the prior current row, inserts the new row, computes the SHA-256 checksum, and writes an `audit_log` entry. `policy_acknowledgments` continues to FK to `policy_versions(id)` so historical consent is preserved.

**Storage privacy:** Both new buckets (`policy-source-archive`, `framework-source-csv`) have `public=false`. RLS policies allow SELECT only when `has_role(auth.uid(), 'admin')`. Edge functions read via service-role for the ingest flow.

**Edge function auth:** `framework-ingest` and `publish-policy-version` validate JWT + admin role per the project-wide `mem://constraints/edge-function-auth` rule. `get-i18n-bundle` is explicitly public (anon-readable strings only, no PII).

**Caching:** i18n edge function returns ETag + SWR caching so the global bundle is effectively a CDN hit after first load; only changed locales re-fetch.

**Rollback:** Each phase has its own migration file and its own feature flag (`content_source: 'db' | 'file'`) read from `app_settings`. Flipping back is one row UPDATE — no redeploy needed during the cutover window.

## Files touched (high level)

```text
# Migrations (4)
supabase/migrations/<ts>_policies_db_first.sql
supabase/migrations/<ts>_framework_csv_to_storage.sql
supabase/migrations/<ts>_i18n_common_bundle_seed.sql
supabase/migrations/<ts>_content_architecture_rails.sql

# Edge functions (3 new, 0 modified)
supabase/functions/framework-ingest/index.ts
supabase/functions/get-i18n-bundle/index.ts
supabase/functions/publish-policy-version/index.ts

# Frontend
src/pages/{TermsPage,TermsOfUsePage,PrivacyPage,CookiesPage,AccessibilityPage,CodeOfConductPage,FirstStepsPage,AdminIngestPage}.tsx
src/pages/admin/PoliciesPage.tsx                  (new)
src/components/LegalPolicyPanel.tsx
src/hooks/usePolicy.ts                            (new)
src/hooks/useFrameworkConstants.ts                (new)
src/i18n/index.ts                                 (backend → edge fn)
src/i18n/fallback.ts                              (new — 20-key offline)
src/lib/skills-framework.ts                       (deleted)

# Rails
scripts/eslint-plugin-no-public-content.mjs       (new)
scripts/check-content-architecture.mjs            (new)
vite.config.ts                                    (content-guard plugin)
.github/workflows/regression.yml                  (add check:content-architecture step)

# Deletions
public/data/                                      (moved to private bucket)
public/policies/                                  (moved to private bucket)
public/locales/                                   (replaced by edge fn)
src/i18n/locales/                                 (replaced by edge fn)

# BDD
bdd_scenarios                                     (25 inserts @content-db-first)

# Memory
mem://tech/data/db-first-content                  (new)
mem://features/policy-pages                       (updated)
mem://features/reference-data-tables              (updated)
mem://index.md                                    (Core entry added)
```

Approve and I ship all four phases in one pass.
