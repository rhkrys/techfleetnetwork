---
name: Eager Freescout Provisioning
description: Members auto-become Freescout customers on profile insert; admins auto-become Freescout staff on role grant. Silent (sendInvite:false), idempotent, retry-on-failure via support-provisioning-retry cron, plus inline fallback in freescout-proxy.
type: feature
---

Every platform user is provisioned in Freescout behind the scenes so they can use ticketing on first click.

## Two identity types

| Type | Column on profiles | Trigger | Edge fn |
|---|---|---|---|
| **Customer** (members opening tickets) | `freescout_customer_id` | `trg_profiles_provision_customer` on `profiles AFTER INSERT` | `freescout-provision-customer` |
| **User** / staff (admins triaging) | `freescout_user_id` | `trg_user_roles_provision_admin` on `user_roles AFTER INSERT WHEN role='admin'` | `freescout-provision-admin` |

Both triggers call `enqueue_freescout_provisioning(user_id, kind)` which inserts a `status='retry', attempts=0` row into `support_provisioning_log`. The existing `support-provisioning-retry` cron (every minute, 25/run, idempotent, no-ops on already-provisioned profiles) drains it.

## Hard rules

- **`_shared/freescout.ts createUser({sendInvite:false})`** — admins never receive a Freescout invite email; the platform proxies every call with the master `FREESCOUT_API_KEY`.
- **Inline fallback** (`_shared/freescout-admin.ts resolveAdminFreescoutUserId`) stays as belt-and-suspenders for the `assign self` + `reply` admin paths inside `freescout-proxy` — provisions on the spot if a trigger ever missed a row.
- **`findUserByEmail` / `findCustomerByEmail`** dedupe at Freescout's API before we POST a create, so concurrent calls are idempotent.
- **Never block the originating insert** — `enqueue_freescout_provisioning` swallows errors with a NOTICE so a Freescout outage cannot prevent a sign-up or admin promotion from committing.

## Backfill

Migration `20260603-eager-freescout` seeded `support_provisioning_log` with one `retry` row per existing un-provisioned member and per existing un-provisioned admin. The cron walks the back-catalog over the hour after deploy.

## Acceptance signal

- 0 `Profile_not_found` audit rows in the 7d window after deploy.
- 100% of new sign-ups have `freescout_customer_id` set within 60s of profile insert.
- 0 Freescout invite emails sent to admins.
- `System Health > Support > Pending provisioning` ≈ 0 outside of momentary cron windows.

## Files

- `supabase/migrations/20260603153901_...sql` — triggers, helper, backfill, peak-hour email cols
- `supabase/functions/freescout-provision-customer/index.ts` — new, service-role-only
- `supabase/functions/freescout-provision-admin/index.ts` — pre-existing, unchanged contract
- `supabase/functions/support-provisioning-retry/index.ts` — drains both kinds (pre-existing)
- `supabase/functions/_shared/freescout.ts` — `createUser` now `sendInvite:false`
- `supabase/functions/_shared/freescout-admin.ts` — inline fallback for admin-write actions
- `supabase/config.toml` — pinned `freescout-provision-customer` (verify_jwt=true)
