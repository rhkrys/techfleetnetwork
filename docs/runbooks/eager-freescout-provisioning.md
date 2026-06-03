# Eager Freescout Provisioning

**Status:** Active as of 2026-06-03
**Owners:** Platform / Support
**Related memories:** `HELP-DESK-046..062`, `mem://features/get-help-secret-contract`, `mem://features/get-help-admin-reply-and-notify`

## Contract

> Any user on the platform — member or admin — can fully use Freescout
> ticketing the moment they exist. No lazy provisioning round-trip on first
> click. No Freescout password-setup emails to admins.

## Two identities, one platform

| Type | Stored on `profiles` | Required for | Created by |
|---|---|---|---|
| **Customer** | `freescout_customer_id` | Member-authored conversations / threads (`customer:{ id }`) | `freescout-provision-customer` edge fn (trigger-driven) |
| **User** (staff) | `freescout_user_id` | Admin-authored replies (`user:<id>`), assignments (`assignTo:<id>`) | `freescout-provision-admin` edge fn (trigger-driven) |

## Provisioning paths

### 1. Eager (primary)

- `trg_profiles_provision_customer` — `AFTER INSERT ON profiles WHERE email IS NOT NULL`
  → `pg_net` POST to `freescout-provision-customer` (service role).
- `trg_user_roles_provision_admin` — `AFTER INSERT ON user_roles WHERE role = 'admin'`
  → `pg_net` POST to `freescout-provision-admin` (service role).
- Both edge fns are idempotent: short-circuit if `profiles.freescout_*_id` is
  already populated; `findUserByEmail` / `findCustomerByEmail` dedupes against
  Freescout's side before insert.

### 2. Retry (recovery)

- All failures (Freescout 5xx, transient transport) insert a row into
  `support_provisioning_log` with `status = 'retry'`.
- `support-provisioning-retry` cron drains pending + retry rows once per
  minute, capped at exponential backoff.

### 3. Inline fallback (belt-and-suspenders)

- `freescout-proxy/index.ts` calls `requireAdminFreescoutUser(userId)` at the
  top of every admin-write switch branch (`assign`, `reply`, future
  `note`/`setAssignee`).
- If the eager trigger missed (race or backfill gap), `resolveAdminFreescoutUserId`
  provisions inline before the upstream PUT — the click still succeeds.
- Members get the same fallback through `ensureCustomerForUser` which is now
  a cache hit in the eager-provisioned steady state.

## Silent admin creation — why `sendInvite: false`

`_shared/freescout.ts → createUser({ sendInvite: false })`. The platform
proxies every Freescout call with the master API key; admins never log into
Freescout directly. Sending the invite email would spam an admin's inbox with
a password-setup link they don't need.

## Action checklist on admin-write actions

When adding a new admin-write action to `freescout-proxy`:

1. Call `requireAdminFreescoutUser(userId)` BEFORE the Freescout HTTP call.
2. Include `user:<freescout_user_id>` in the request body (Freescout 422s
   without it for reply/note paths).
3. For assignments, set `assignTo:<freescout_user_id>` (Freescout 404s
   `Profile_not_found` without it).

Status-only actions (`close`, `reopen`, `setPrivate`) do not need a user id.

## Observability

- **System Health → Help Desk tab** — `HelpDeskTab.tsx` renders the live
  `support_provisioning_log` (last 50) plus a 13-month ticket histogram and
  per-mode backfill buttons.
- **Audit tags** — every failure carries
  `reason:provisioning_failed kind:<customer|admin> upstream:<status>`.
- **Definition of done (7d):** 0 `Profile_not_found`, 0 lazy customer creates
  on first ticket-open click, 0 Freescout invite emails to new admins, 100%
  of new signups provisioned within 60 seconds.

## Backfill

The 2026-06-03 migration seeds `support_provisioning_log` with one pending
row per existing un-provisioned `profiles` row. The retry cron walks the
back-catalog within ~60 minutes of deploy with zero user impact (idempotent
+ lazy fallback still works).
