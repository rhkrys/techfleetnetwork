# Data Classification, Inventory & Retention — SPF Data Layer + Hand-Off System

Status: Phase 0 governance artifact for the Hand-Off Production System + SPF data-layer work.
Companion to `docs/compliance/privacy-runbook.md` and the DPIA
(`spf-handoff-dpia.md`). Classification scheme: **Public / Internal / Confidential /
Restricted** (Restricted = personal or otherwise sensitive data — strongest controls).

## Why this exists

Per the compliance-data-lifecycle skill: "Know what data you hold, why you're allowed to hold
it, how long you keep it, who can touch it, how you'd prove that to an auditor, and how you'd
get it back if it's lost." This inventory is what makes deletion, export, and audit
_executable_ — every store below is a place a DSAR deletion/export must reach.

## Inventory

| #   | Data store                                                        | Contents                                                                    | Class                                            | Lawful basis / purpose                                         | Retention                                  | Deletion reaches it via                      |
| --- | ----------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------- | ------------------------------------------ | -------------------------------------------- |
| 1   | `spf_datasets_raw` + `spf_*` snapshot                             | Public framework taxonomy (CC BY 4.0), non-personal                         | **Public/Internal**                              | N/A (public open data; attribution tracked)                    | Keep latest + N prior versions             | n/a (no personal data)                       |
| 2   | `handoff_deliverable_submissions` (text ≤10k)                     | Free-text component entries (may name teammates, clients, stakeholders)     | **Restricted**                                   | Legitimate interest: producing the team's own project hand-off | Until project retention window expires     | DB row delete (§ deletion)                   |
| 3   | `handoff-deliverables` bucket (uploaded files)                    | PDF/doc/CSV/spreadsheet/PNG/JPG deliverables                                | **Restricted**                                   | Same                                                           | Same                                       | Storage blob delete                          |
| 4   | Parsed/normalized content + extracted **fact base**               | Derived text from 2 & 3                                                     | **Restricted**                                   | Same (derived)                                                 | Tied to the run                            | DB row delete                                |
| 5   | `handoff_output_files` + `handoff-outputs` bucket                 | The 4 generated versions (MD + PDF), all historical versions                | **Restricted**                                   | Same                                                           | Version-history retention window           | Storage blob + row delete, **all versions**  |
| 6   | `handoff_productions` (run metadata)                              | project, phase, triggered_by (user id), status, model, spf_version          | **Confidential**                                 | Operational                                                    | Same as outputs                            | DB row delete                                |
| 7   | Audit log entries                                                 | who produced/downloaded/regenerated, SPF sync/replace, cross-project access | **Confidential** (contains user ids, no content) | Compliance obligation                                          | ≥ 1 year, **outlasts** the data it records | Not deleted on DSAR (legal record); ids only |
| 8   | RAG vectors in `knowledge_base` derived from personal-data inputs | Embeddings of hand-off content, if ingested                                 | **Restricted**                                   | Same as source                                                 | Tied to source                             | Re-embed/delete on source deletion           |
| 9   | LLM sub-processors (OpenRouter → Anthropic, DeepSeek)             | Prompt + generated text in transit                                          | **Restricted**                                   | Processing for generation                                      | Not retained by us; per each DPA           | Covered by subprocessor DPAs (§ vendors)     |

> Email content/logs (Restricted/Confidential) are **out of scope** for this build —
> distribution is deferred until the email subsystem is fixed (see the plan). Add rows 10–11
> when that phase lands.

## Retention & deletion

- **Retention window** (locked decision): version history keeps latest + archives older with a
  bounded window that caps growth; expiry is **automated** (soft-delete → scheduled hard-delete)
  with its own audit-log entry. Deletion jobs are idempotent, resumable, dry-run-against-counts
  first, and take a verified backup before large purges.
- **DSAR deletion must PROPAGATE** to every Restricted store above (2, 3, 4, 5, 8) plus caches;
  a delete that only removes the primary row is a compliance failure. Backups follow the
  documented "time-boxed retention + deleted data is not restored to prod" policy rather than
  surgical backup edits.
- **DSAR export** must gather all personal data across derived stores (2–6, 8), not just the
  primary rows.

> **Implementation status:** the retention/expiry job and DSAR erasure/export propagation to the
> hand-off stores are PLANNED (Phase B3) and **NOT yet implemented in code**. The controls above are
> the target design; do not treat them as active until the Phase B3 lifecycle work lands.

## Vendors / subprocessors

- **OpenRouter (US), Anthropic (US), and the US inference providers hosting the DeepSeek
  mechanical model** are **new subprocessors** for Restricted data (prompts contain personal
  data) → each requires a DPA + entry in the subprocessor register. **Cross-border to China is
  resolved in code:** the DeepSeek model is pinned to US OpenRouter providers
  (CoreWeave/Together/Fireworks/DeepInfra/BaseTen) in `supabase/functions/_shared/llm/port.ts`
  (`US_INFERENCE_PROVIDERS`, `allow_fallbacks: true`), so DeepSeek's own China endpoint is never
  used — verified served-provider = CoreWeave (US). DPAs remain an owner action.
- **Supabase Storage** (existing) holds Restricted blobs → same-classification controls
  (private buckets, encryption at rest, signed-URL scoping).

## Data minimization (privacy by design)

The **workshops/deliverables thin-projection** (Locked decision 10) is the concrete
minimization control: the generation context receives only the ~6 fields it needs, not the
~29-field workshop record. Every field entering the LLM context is justified against a
generation need. The Org Case Study / analytics-facing version pseudonymizes where identity
isn't required.
