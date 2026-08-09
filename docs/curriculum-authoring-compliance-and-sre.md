# Class Curriculum Authoring v2 — Compliance & Operational Readiness

Evidence artifact for the teacher-authored curriculum feature (Classes MVP). Pairs with
the migrations `20260808160000..160300`, the pgTAP suite `supabase/tests/curriculum_v2_test.sql`,
and the OWASP threat-model pass. Covers the compliance-data-lifecycle and
sre-operational-readiness skill requirements.

## 1. Data classification

| Data                      | Store                                     | Classification                       | Personal data?       |
| ------------------------- | ----------------------------------------- | ------------------------------------ | -------------------- |
| Lesson text / video links | `class_module_items` (Postgres)           | Internal / confidential (teacher IP) | No                   |
| Lesson files              | `class-module-files` bucket (**private**) | Confidential (arbitrary uploads)     | Possibly, incidental |
| Attachment metadata       | `class_module_attachments`                | Internal                             | No                   |
| Learner completion        | `class_module_progress`                   | **Behavioral personal data**         | **Yes**              |
| Authoring actions         | `class_module_audit`                      | Audit / internal                     | Actor id only        |

Encryption at rest and TLS in transit are provided by the Supabase platform. The file
bucket is private; bytes are served only via short-lived (5-min) signed URLs with forced
`Content-Disposition: attachment`, gated by entitlement **and** release.

## 2. Privacy / data-subject rights

**Right to erasure (GDPR Art.17 / CCPA delete).** Account deletion is a single
`auth.admin.deleteUser()` (see `delete-account` edge function) → `on_auth_user_deleted` +
FK actions. The new surface is governed by FK behavior, verified against the migrations:

- `class_module_progress.user_id` → `ON DELETE CASCADE` — a learner's completion history is
  removed automatically. ✅
- `class_module_attachments.created_by` → `ON DELETE SET NULL` — teacher-authored content is
  **retained as business IP**, with the actor anonymized. Documented rule, not a bug.
- `class_module_audit.actor_user_id` → `ON DELETE SET NULL` — audit trail survives with the
  actor anonymized (audit integrity).

No change to the deletion trigger is required; the FK actions make the auth-user delete
succeed and behave correctly.

**Right to access / portability (DSAR).** There is no automated data-export path in the
app: `dsar-submit` only files a request row (`submit_dsar` → `dsar_requests`), and an admin
fulfils access/portability requests **manually** (see `PrivacyRequestsTab`). Because
`class_module_progress` is behavioral personal data, **manual fulfilment MUST include it.**
Runbook — when exporting a subject's data, add their curriculum progress:

```sql
SELECT user_id, item_id, class_id, completed, completed_at
FROM public.class_module_progress
WHERE user_id = '<subject_user_id>';
```

Teacher-authored content (`class_module_items`, `class_module_attachments`) is business IP,
not the requester's personal data, so it is **not** part of a learner DSAR export. A
self-serve export feature covering all PII is a separate, out-of-scope initiative (decided
2026-08-08: keep the manual process; document the curriculum step here).

**Minimization.** Audit rows written by the new RPCs contain only bounded metadata
(URL truncated to 120 chars, filename, size, policy params) — never content bodies. The
pre-existing `upsert_class_section` / `upsert_class_module_item` audit writes still snapshot
the whole row (finding **F9**); that is pre-existing behavior, left unchanged here and
tracked as debt.

## 3. Retention

- `class_module_audit` grows unbounded. **Recommendation:** 24-month retention, pruned via
  the existing cron-retention pattern (e.g. `cron_history_retention`). → **Follow-up (P2):**
  add the retention job (requires a `pg_cron` schedule; out of scope for the code migration).
- **Orphan storage reclamation.** Deleting a module / section / class cascade-deletes
  attachment _rows_ but not the bucket _objects_. Orphaned objects remain access-controlled
  (their path encodes the class; `can_read_class_module_file` still requires class ownership
  or entitlement + release), so this is wasted storage, **not** a data-exposure. Explicit
  attachment deletion already removes the object (`delete_class_module_attachment` returns
  the path and the client deletes it). → **Follow-up (P2):** a scheduled reconciliation that
  deletes bucket objects with no `class_module_attachments` row.

## 4. Migration safety (data-lifecycle lens)

All four migrations are additive / expand-phase and rebuildable from scratch (validated by
the blocking `migration-smoke` CI job, `supabase db reset`). New columns on `classes` are
defaulted (`release_policy = 'all_at_once'`), so existing rows are valid and existing
behavior is preserved. No destructive or backward-incompatible step ships — F1 is closed by
making the learner RLS release-aware, which is a no-op for every existing (all_at_once)
class, so no separate contract migration and no down-migration are required for rollback
(revert = redeploy the previous frontend; the additive DB objects are inert to old code).

## 5. SRE / operational readiness (production-readiness review)

**New hot path:** `get_class_curriculum_for_learner` (learner read) and the authoring RPCs.

**SLIs / SLOs (targets to instrument):**

- Learner read RPC: availability 99.9%; latency p95 < 400 ms at cohort scale.
- Authoring writes (upsert / reorder / publish / set_release_policy): p95 < 600 ms, error
  rate < 0.5%.
- Signed-URL mint: p95 < 300 ms.

**Four golden signals** to instrument on the new RPCs + upload path: latency, traffic
(reads/writes per min), errors (by SQLSTATE — `forbidden` 42501, `not_released`,
`invalid_url`/`unsupported_mime`/`invalid_path` 22023, validation), saturation (DB
connections, storage egress GB).

**Alerts (symptom-based):** page on learner-read error-rate > 2% for 5 min or p95 > 1 s for
10 min; ticket on an upload-failure spike; **security** alert on a sustained rise in
`forbidden` (probing) or in rejected uploads.

**Runbook (symptom → first checks):**

- _"Learners can't see published content"_ → check the class `release_policy` + params; for
  `by_date`/`relative` confirm the clock/cohort start; confirm entitlement
  (`is_class_learner`); the read RPC is authoritative — compare against `class_item_release`.
- _"Teacher gets forbidden after approval"_ → confirm the `teacher` role row exists
  (`_assert_class_editor` requires current standing) and class ownership.
- _"File download 403 / expired"_ → signed URL TTL is 5 min; re-mint; confirm
  `can_read_class_module_file` (entitlement + release) for the caller.
- _"Reorder looks wrong"_ → deferrable-unique + negative-staging; check
  `class_module_audit` (`entity_type='reorder'`) for the last order applied.
- Reconstruct any change from `class_module_audit` (actor + timestamp + action).

**PRR checklist before enabling for all teachers:** migrations applied + smoke-passed (CI);
RLS negative tests green (pgTAP); the new RPCs instrumented with the golden signals above;
alerts armed; rollback rehearsed (redeploy previous frontend).

## 6. Cost guardrails (see storage-architecture analysis)

Video is embed-only (never in the bucket) — the single biggest egress lever. Files: 100 MB
ceiling + MIME allowlist enforced at both the storage edge and the register RPC; per-item
attachment cap of 100. These keep a 100+ course catalog in the low tens of $/mo for files.

## 7. Open compliance/ops follow-ups (status as of 2026-08-08)

1. ✅ **DSAR — done (documentation).** No automated export exists; §2 now records the
   mandatory manual-fulfilment step + query for `class_module_progress`. A self-serve export
   feature is intentionally out of scope (decided 2026-08-08).
2. ✅ **Retention — done.** `class_module_audit` pruned > 24 months daily via pg_cron
   (`purge-class-module-audit`, migration `20260808170000`).
3. ✅ **Orphan-object reclamation — done.** SQL diff `list_class_module_file_orphans(interval)`
   (read-only) + the `reap-class-module-orphans` edge function (Storage-API deletion) on a
   daily pg_cron poke (migration `20260808180000`). **Dry-run by default** — deletes only when
   `CURRICULUM_ORPHAN_REAP_APPLY='true'`; 48h grace window; path-shape guard so it can never
   touch a key outside `class/{id}/item/{id}/…`. Flip the env to activate after observing the
   logged orphan counts.
4. Field-level, bounded audit diff for `upsert_class_section` / `upsert_class_module_item`
   (finding F9, pre-existing) — **P2, open.**
5. Antivirus scan of uploads before first serve — **P1, open** (noted in the OWASP pass).
6. **Class entitlement — resolved: access is OPEN by design.** Per the product owner
   (2026-08-08), any active member can register for a class openly; **Gumroad handles only
   discounts at checkout — it is NOT an access gate.** So `is_class_learner` = "has a cohort
   registration" is the **final, correct** model (registration is open to all active members),
   not a placeholder to be tightened. The earlier "F2 over-grant / tighten to verified
   purchase" framing was wrong and is retracted. (Fixing the Gumroad webhook secrets
   `GUMROAD_PING_SECRET` / `GUMROAD_SELLER_ID` still matters for _membership-tier_ recognition
   generally, but it is unrelated to class-curriculum access.)
