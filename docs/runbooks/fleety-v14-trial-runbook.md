# Fleety v1.4 — trial-enablement runbook (operator steps)

These steps are applied **manually** (this repo has no auto-migrate/auto-ingest on merge).
Run them in order to reach a trial-worthy Fleety. All are reversible.

**Prereqs**

- Supabase project ref: `pzvqxdgoztbfikfuifix` → functions base `https://pzvqxdgoztbfikfuifix.supabase.co/functions/v1`
- `SUPABASE_SERVICE_ROLE_KEY` (Dashboard → Project Settings → API). Keep secret; run from your machine.
- SQL access (Dashboard SQL editor, or `psql` with `PGPASSWORD` + `prod-ca-2021.crt`).

---

## Step 0 — Deploy the code

- Phase 1 (DeepSeek + determinism + Sources UI) is already merged (#205) and deployed.
- Merge **PR #206** (guide-ingest) after CI is green → the edge-functions workflow deploys `guide-ingest`.

## Step 1 — Ingest guide.techfleet.org into the KB (real links)

```bash
curl -sS -X POST "https://pzvqxdgoztbfikfuifix.supabase.co/functions/v1/guide-ingest" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" -d '{}'
```

Expect `{ ok:true, pages:~200, added, updated, unchanged, errored }`. New/changed pages land with `embedding=NULL`.

## Step 2 — Re-embed the KB (fixes the 952 unembedded rows + the new guide rows)

Run repeatedly until the response shows `"embedded":{"kb":0}` (≈7–8 runs for ~1,350 rows):

```bash
curl -sS -X POST "https://pzvqxdgoztbfikfuifix.supabase.co/functions/v1/fleety-embed" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" -d '{"mode":"backfill","table":"kb","limit":200}'
```

## Step 3 — Activate SPF as the framework source of truth

In the SQL editor:

```sql
select public.framework_set_source('spf','v1');
select active_source, spf_active_version from public.framework_source_config;  -- expect: spf, v1
```

(The function refuses if the SPF snapshot is empty/partial — it isn't; ~900 rows / 21 types.)

## Step 4 — Trial Fleety

Ask, and confirm each answers well **and** shows a "📚 Sources" list with real links:

- "What are the first steps to join Tech Fleet?" (onboarding + guide link)
- "What are the Scrum meetings?" (handbook link)
- "How do I improve psychological safety on my team?" (team practices)

---

## Rollback (instant, safe)

- Framework source: `select public.framework_set_source('reference');`
- Code: revert the relevant PR merge and redeploy.

## Not in this runbook (next code phase — Phase 3)

Embedding SPF **workshops / workshop-steps / milestones / deliverables / career-transitions / articles**
into the **semantic** KB with `…/explore/#item/<slug>` deep-links, plus step-by-step prompt guidance.
Until then, SPF reaches Fleety via the framework **graph** (Step 3); guide content reaches it via the
**semantic KB** (Steps 1–2). `framework://` reference-derived KB rows still lack navigable links — that
resolves in Phase 3 + the Phase 4 legacy removal.
