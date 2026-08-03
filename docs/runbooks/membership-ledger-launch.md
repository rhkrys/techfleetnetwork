# Runbook — Launch the Early Career Membership ledger→projection (PR #128)

**Change class:** DB schema **expand** + edge-function refactor + UI. Backward-compatible
by design (the column guard exempts `service_role`, so old edge code keeps working
during the rollout window). Reversible.

## ⚠️ Order is load-bearing
The new edge functions call `compute_membership()` and write the new ledger columns/
catalog. Those must exist **before** the edge functions deploy, or a purchase during
the gap errors. Migrations do **not** auto-apply on this project, and merging `main`
auto-deploys the edge functions + frontend. Therefore: **schema first, then merge.**

## Pre-flight (verify, don't skip)
1. `supabase db reset` on a local/scratch DB, then `supabase db test` → the pgTAP
   suite (`supabase/tests/membership_ledger_test.sql`) passes. This is the only
   execution-verification of the SQL.
2. CI on PR #128 is green (it is: deno-check + all gate-test shards + gate-verify).

## Deploy sequence
1. **Apply the schema to the live project** (`pzvqxdgoztbfikfuifix`), in order, via
   `supabase db push` or by pasting each migration into the SQL editor:
   - `20260803120000_membership_ledger_projection.sql` (ledger, catalog, projector, guard, triggers, RPCs, one-time backfill)
   - `20260803120500_membership_reproject_cron.sql` (nightly sweep)
   - `20260803121000_membership_ledger_bdd.sql` (BDD rows)
   After it runs, `NOTIFY pgrst, 'reload schema';` so PostgREST sees the new RPCs.
2. **Verify the schema is healthy** (SQL editor):
   - `SELECT * FROM public.membership_health();` (as an admin) returns a row.
   - `SELECT public.compute_membership(auth.uid());` — no error.
   - Existing paid members already show their tier (the one-time backfill ran).
3. **Merge PR #128** → Cloudflare deploys the frontend; `deploy-edge-functions.yml`
   deploys webhook/backfill/reconcile. (Old + new coexist briefly — safe, guard
   exempts `service_role`.)
4. **Set the Gumroad config** (the D-1 step — recognition can't flow without it):
   - Secrets on the project: `GUMROAD_ACCESS_TOKEN`, `GUMROAD_PING_SECRET`, `GUMROAD_SELLER_ID`.
   - Re-point the Gumroad Ping/Resource-subscription URL to
     `https://pzvqxdgoztbfikfuifix.supabase.co/functions/v1/gumroad-webhook?secret=<GUMROAD_PING_SECRET>`
     and subscribe the `sale`, `refund`, `dispute`, `cancellation`, `subscription_ended` events.
5. **Smoke-test live:** a real (or test) founding purchase → member shows Early Career
   Membership within seconds (webhook) or on next login (backfill); a refund → downgrades.

## Verify after launch
- `SELECT * FROM public.membership_health();` → `invariant_violations = 0`,
  `last_sale_received_at` recent after a test purchase.
- Katie Uram (or any known payer) flips `starter → community` on next login.
- Watch `audit_log` for `membership_invariant_violation`, `gumroad_ingestion_misconfigured`,
  `malicious_webhook_signature_invalid` for 48h.

## Rollback (fast + safe)
- **Code:** revert the merge / redeploy the previous edge-function + frontend build.
  The old code writes `profiles.membership_*` directly as `service_role` — still
  allowed by the guard — so it keeps functioning against the new schema.
- **Schema:** the migration is **expand-only** (adds columns/tables/functions; drops
  nothing), so leaving it in place after a code rollback is harmless. Do **not**
  drop the new objects as a rollback — old code tolerates them.
- **Kill the projector's effect** in an emergency: `UPDATE public.membership_products
  SET is_active = false;` makes the catalog grant nothing (new projections fall back
  to starter) without touching code. Re-enable to restore.

## Monitoring
- `membership_health()` → System Health tile (last sale, pending queue, invariant violations).
- Nightly `cron.job` `membership-reproject-drift` self-heals + audits violations.
- Alert on any `membership_invariant_violation` audit row — that means a paid tier
  exists with no backing active sale (bug or tampering).
