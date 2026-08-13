# Runbook — SPF sync failure

Skeleton (finalized in Phase A1 once `spf-sync` ships). Linked from the SPF freshness /
sync-success alerts.

**Symptom / alert:** SPF freshness SLI stale beyond threshold, or sync-success SLO burn.

**Severity:** SEV2 if sync is failing past the freshness SLO and blocking data updates; SEV3
for a single-dataset failure with the last-good snapshot still serving.

**First: mitigate, then diagnose.** Users keep reading the **last-good snapshot** (atomic swap
means a failed run never swaps in), so there is no user-facing outage from a single failed
sync — do not page unless freshness is genuinely breached.

**Diagnose (in order):**

1. Check the sync run's structured logs by correlation id — which stage failed: fetch /
   schema-validate / normalize / swap?
2. **Fetch failure** → is GitHub Pages up? (`GET` the manifest URL). If down, see
   [spf-source-outage.md](spf-source-outage.md).
3. **Schema-validate failure** → the contract test (`_shared/spf/contract.test.ts`) is the
   oracle. A real SPF v2/field change means: DO NOT force the ingest; update the pinned
   contract deliberately (a code change + PR), then re-run. Fail-closed is working as intended.
4. **Normalize / swap failure** → check DB load / locks; the swap is transactional, so a
   failure leaves the previous snapshot active.

**Recover:** re-run the sync (idempotent + resumable from checkpoint). Confirm freshness SLI
recovers and Fleety reads current data.

**Escalate / rollback:** if a bad snapshot did swap in, flip `framework_source_config` back to
the last-good source/version (see [ADR-0003](../adr/0003-framework-graph-rebuild-facade.md)).

_TODO (Phase A1): exact function name, invoke command, checkpoint table, dashboard links._
