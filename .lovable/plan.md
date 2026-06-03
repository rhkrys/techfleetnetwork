# Activity-log audit (2026-04-15 → 2026-06-02) — next refactor batch

24,293 audit rows analyzed. "Last 7d" = May 27 – Jun 2, "prior" = Apr 15 – May 26.

---

## §0. Already holding (do NOT re-touch)

| Memory | Last-7d signal |
|---|---|
| AUTH-WEDGE | 0 `transient_bad_jwt` purges |
| AUTH-RESET (today) | 0 `password_update_rejected` |
| TRIAGE-NOISE | 0 `stale_chunk`, 0 opaque `Script error.` |
| DEPLOY-WATCH | 0 reload clusters |
| EMAIL-RL lane isolation | Auth lane hit 1×, bulk 26× — isolation working |
| EDGE-CORS-TRACE | All `edge_invoke_failed` carry `severity:warn` |
| UI-BOUNDARY | `ui_render_error` 157 → 1 |
| LOGIN-RL fairness | 0 `login_rate_limited` (39 prior) |

---

## §1. Fix in this batch

### Issue A — Freescout identity provisioning is *partially* automatic — make it fully zero-touch

#### A.0 How Freescout identities work today (read this before changing anything)

Freescout has two completely different identity tables:

| Type | Who | Platform column | Provisioning today | How it gets created |
|---|---|---|---|---|
| **Customer** | Members opening tickets | `profiles.freescout_customer_id` | **Lazy** — only when they first `create` a ticket or admin replies on their behalf | `ensureCustomerForUser()` inside `freescout-proxy` → `findCustomerByEmail` → `createCustomer` |
| **User** (staff) | Admins triaging | `profiles.freescout_user_id` | **Two paths, both incomplete**: ① `freescout-provision-admin` called from `ConfirmAdminPage` after admin role insert (correct in theory, fails silently if Freescout 5xx and is never retried); ② `resolveAdminFreescoutUserId()` inline fallback inside `freescout-proxy`, but **only wired into `reply` and `assign`** | `findUserByEmail` → `createUser({ sendInvite: true, mailboxes: [DEFAULT_MAILBOX_ID] })` |

The hard rule the user reported:
- A Freescout **conversation reply by an admin requires `user:<freescout_user_id>`** or Freescout 422s.
- A Freescout **`assign` PUT requires `assignTo:<freescout_user_id>`** or Freescout 404s with `Profile_not_found` (the symptom in audit_log).
- A **member-authored thread requires `customer:{ id|email }`** or Freescout 422s.

So **every admin-write action must guarantee `freescout_user_id` exists**, and **every member-write action must guarantee `freescout_customer_id` exists**. Today only `reply` (admin branch) and `assign` (self branch) call the user-side resolver. `close`, `reopen`, `setPrivate` don't need a user id (they're status-only PUTs and Freescout accepts them with just the API key), but the moment we add `note`, `setAssignee` (to another admin), or `deleteThread`, they will need it too.

Also: `sendInvite: true` in `createUser` emails the admin a Freescout password-setup link. Admins should NOT need a separate Freescout login — the platform proxies every call with the master API key. **Change to `sendInvite: false`** so new admins are silently created with no inbox spam.

#### A.1 Goal (per user)

> Any user in the system can fully use Freescout ticketing the moment they exist on the platform. New members can open a ticket on first click; new admins can triage on first click. The platform owner never has to touch Freescout admin UI again.

#### A.2 Scope (single PR)

**Member provisioning — move from lazy to eager:**
- New edge function `freescout-provision-customer` (service role only), same shape as `freescout-provision-admin` but creates a **customer**, sets `profiles.freescout_customer_id`, logs to `support_provisioning_log`.
- DB trigger `trg_profiles_provision_customer` on `profiles AFTER INSERT WHEN NEW.email IS NOT NULL` → pg_net call to the function (fire-and-forget, idempotent — function no-ops if `freescout_customer_id` already set).
- Retry: existing `support-provisioning-retry` cron already drains `support_provisioning_log` rows with `status='retry'`. Extend it to also cover `kind='customer'` failures.
- Email-change trigger already calls `freescout-sync-customer` — keep as-is.
- Backfill migration: enqueue every existing `profiles` row missing `freescout_customer_id` via `support_provisioning_log` (status='pending') so the retry worker walks the back-catalog over the next hour.

**Admin provisioning — make eager + universal + silent:**
- DB trigger `trg_user_roles_provision_admin` on `user_roles AFTER INSERT WHEN NEW.role='admin'` → pg_net to `freescout-provision-admin`. (Today this only runs if the human clicks through `ConfirmAdminPage`.)
- Edit `_shared/freescout.ts → createUser()`: set `sendInvite: false`, keep `role:"user"`, ensure `mailboxes:[DEFAULT_MAILBOX_ID]` so they can see the queue.
- Extend `_shared/freescout-admin.ts → resolveAdminFreescoutUserId()` to be called from **every admin-write branch** in `freescout-proxy/index.ts`: `assign` (both `"self"` and explicit-id paths — explicit-id path still needs the *caller's* user id for the Freescout `user:` audit field on the PUT), `reply` (already), and the new `note`/`setAssignee`/`setStatus` if added later. Add a single helper `requireAdminFreescoutUser(userId)` at the top of the switch for admin actions so we cannot forget again.
- Race-safe: `resolveAdminFreescoutUserId` already does `findUserByEmail` first (idempotent on Freescout's side) before insert; add a `profiles` unique partial index on `(email) WHERE freescout_user_id IS NOT NULL` is **not** needed — Freescout itself dedupes.

**Observability:**
- `support_provisioning_log` already exists. Surface "Pending provisioning (last 24h)" and "Failed provisioning" tiles in System Health → Support tab.
- Every provisioning failure tagged `reason:provisioning_failed kind:<customer|admin> upstream:<status>`.

#### A.3 Expected outcome

- **Customer**: a member who signed up 2 seconds ago, never opened Get Help, clicks "Submit a ticket" → succeeds on first POST with `customer:{ id: <their id> }` (no lazy round-trip to Freescout `/api/customers` during the click).
- **Admin**: a member promoted to admin 2 seconds ago, never visited Get Help admin view, clicks "Assign me" → succeeds on first PUT.
- **Zero** `Profile_not_found` audit rows in the 7d window after deploy.
- **Zero** Freescout invite emails to admins after deploy (silent provisioning).
- `support_provisioning_log` shows `status='success'` for 100% of new signups within 60s of profile insert.

#### A.4 Use cases

1. New member signs up via email → trigger fires → customer row exists in Freescout before the welcome email lands.
2. New member signs up via Google OAuth → same trigger fires off the same profile insert.
3. Member opens first ticket → no lazy provisioning needed; `ensureCustomerForUser` short-circuits on cache hit.
4. Member changes their email → existing `freescout-sync-customer` already updates the Freescout customer; no change.
5. Member soft-deletes account → existing `anonymize` path already covers; no change.
6. Existing user promoted to admin via `user_roles` insert (any path: ConfirmAdminPage, SQL backfill, edge fn) → trigger fires → admin user exists in Freescout within seconds, no invite email.
7. New admin clicks "Assign me" on first ever ticket → succeeds (eager provisioning already done; inline fallback as belt-and-suspenders).
8. New admin clicks Reply → succeeds with `user:<id>` body field.
9. Freescout returns 5xx on provisioning → row inserted to `support_provisioning_log` with `status='retry'`; cron drains; user sees no error if they haven't clicked anything yet, sees inline "Helpdesk briefly unavailable" if they have.
10. Two concurrent profile inserts for the same email (shouldn't happen; tested) → `findCustomerByEmail` wins on second call; one DB row, one Freescout row.
11. Admin demoted then re-promoted → `freescout_user_id` already populated; trigger no-ops.
12. Backfill: every existing member without `freescout_customer_id` is provisioned within 60 minutes of deploy via the retry cron, with zero user impact (idempotent + lazy fallback still works).

#### A.5 BDD scenarios (HELP-DESK-046..062)

```
Scenario: HELP-DESK-046 New member auto-provisioned as Freescout customer on signup
  Given a new auth.users row triggers profile insert with email "newbie@example.com"
  When the trg_profiles_provision_customer trigger fires
  Then [Code] freescout-provision-customer is called within 5s
  And [DB] profiles.freescout_customer_id is populated within 30s
  And [DB] support_provisioning_log has one row kind:customer status:success
  And [Freescout] one customer record exists with email "newbie@example.com"

Scenario: HELP-DESK-047 Eager-provisioned member opens first ticket without lazy fetch
  Given profiles.freescout_customer_id is already populated
  When the member POSTs {action:"create", subject:"...", body:"..."} to freescout-proxy
  Then [Code] ensureCustomerForUser short-circuits on the cached id
  And [Network] only one outbound Freescout call (POST /api/conversations) is made
  And [UI] the ticket appears in the member's list within 2s

Scenario: HELP-DESK-048 Google-OAuth signup also provisions
  Given a member signs up via Google OAuth
  Then [DB] profiles.freescout_customer_id is populated within 30s (same trigger path)

Scenario: HELP-DESK-049 New admin auto-provisioned silently on role insert
  Given a user_roles row is inserted with role='admin' for user X
  When the trg_user_roles_provision_admin trigger fires
  Then [Code] freescout-provision-admin is called with userId:X
  And [DB] profiles.freescout_user_id is populated within 30s
  And [Freescout] no invite email is sent (sendInvite:false)
  And [DB] support_provisioning_log has one row kind:admin_user status:success

Scenario: HELP-DESK-050 First-time admin assigns ticket on first click
  Given an admin promoted 10 seconds ago with freescout_user_id already populated
  When they POST {action:"assign", assigneeUserId:"self", conversationId:42}
  Then [Code] requireAdminFreescoutUser returns the cached id (no Freescout round-trip)
  And [Freescout] PUT /api/conversations/42 includes assignTo:<that id>
  And [DB] audit_log has 0 rows with upstream_code:Profile_not_found

Scenario: HELP-DESK-051 First-time admin replies on first click
  Given an admin freshly provisioned
  When they POST {action:"reply", conversationId:42, body:"..."}
  Then [Freescout] POST /threads body contains user:<their freescout_user_id>
  And [UI] reply appears in the thread within 2s

Scenario: HELP-DESK-052 Admin status change works without a user id requirement
  When an admin POSTs {action:"close", conversationId:42}
  Then [Freescout] PUT succeeds with body {status:"closed"} (no user id required)

Scenario: HELP-DESK-053 Inline fallback still provisions if trigger missed
  Given an admin somehow exists with freescout_user_id NULL (race / backfill gap)
  When they click Assign me
  Then [Code] resolveAdminFreescoutUserId provisions inline before the PUT
  And [DB] profiles.freescout_user_id is populated
  And [UI] assignment succeeds on the same click (no retry needed)

Scenario: HELP-DESK-054 Provisioning failure surfaces and retries
  Given Freescout returns 503 to the provisioning POST
  Then [DB] support_provisioning_log row inserted with status:retry
  And [Code] support-provisioning-retry cron drains it within its next tick
  And [UI] if the user is actively clicking, inline banner "Helpdesk briefly unavailable — retrying"

Scenario: HELP-DESK-055 Concurrent first-use race is idempotent
  Given two tabs of the same un-provisioned admin fire assign within 200ms
  Then [Freescout] findUserByEmail dedupes — only one user row created
  And [DB] profiles.freescout_user_id is set exactly once
  And [UI] both tabs succeed

Scenario: HELP-DESK-056 Backfill walks the back-catalog
  Given the deploy seeds support_provisioning_log with pending rows for all unprovisioned profiles
  When the retry cron runs every minute
  Then [DB] all rows reach status:success within 60 minutes
  And [UI] no user sees an error during backfill

Scenario: HELP-DESK-057 Admin promoted via SQL backfill is auto-provisioned
  Given an admin is inserted via SQL (not ConfirmAdminPage)
  Then [DB] the trigger still fires and freescout_user_id is set within 30s

Scenario: HELP-DESK-058 Admin demoted then re-promoted is a no-op
  Given an admin already has freescout_user_id
  When their role is deleted then re-inserted
  Then [Code] freescout-provision-admin returns alreadyProvisioned:true
  And [Freescout] no new user record is created

Scenario: HELP-DESK-059 New admin receives no Freescout invite email
  Given sendInvite:false in createUser
  When a new admin is provisioned
  Then [Email] zero emails delivered from Freescout to the admin's inbox

Scenario: HELP-DESK-060 Member email change syncs to Freescout customer
  Given a member with freescout_customer_id changes their profile email
  Then [Code] freescout-sync-customer is called with action:"sync"
  And [Freescout] PUT /api/customers/:id updates the email

Scenario: HELP-DESK-061 System Health shows provisioning queue health
  When an admin opens System Health → Support
  Then [UI] "Pending provisioning (24h)" and "Failed provisioning" tiles render
  And [UI] failed rows have a "Retry now" button that re-enqueues

Scenario: HELP-DESK-062 100% of edge_invoke_failed rows carry upstream tag
  Given freescoutInvoke outer-catch is patched (see Issue B)
  When any freescout-proxy call fails for any reason
  Then [DB] the audit row's changed_fields contains upstream:<status|transport_error>
```

#### A.6 Acceptance criteria for Issue A

- 7d after deploy: 0 `Profile_not_found`, 0 lazy customer creates during ticket-open clicks (audit shows `cust_provision_lazy` count = 0), 100% of new signups provisioned within 60s, 0 Freescout invite emails sent.

---

### Issue B — `edge_invoke_failed` rows missing `upstream:` tag

**Symptom:** 20/22 freescout-proxy `edge_invoke_failed` rows last 7d have no `upstream:*` extra.
**Root cause:** Outer `catch` in `src/lib/support/freescoutInvoke.ts` adds `reason:transport_exception` but not the `upstream:transport_error` tag the triage memory requires.
**Fix:** Outer-catch also pushes `upstream:transport_error` + `error_name:<name>`; mirror in `src/integrations/supabase/audited-invoke.ts`.
**Goal:** 100% tag coverage so triage can group by upstream code.
**BDD (HELP-DESK-063..066):** HTTP-error tagged; transport-error tagged; outer-catch tagged; success writes no row.

---

### Issue C — Autosave retry loop on application forms

**Symptom:** 51 `autosave.general-application` + 35 `autosave.project-application` warnings/14d; same user, every 2 minutes, identical generic error.
**Root cause:** `src/hooks/use-autosave.ts` has no circuit-open state — the 30s ticker keeps calling `flush()` indefinitely even after the 3-backoff failure ceiling, and 4xx errors retry the same way as 5xx.
**Scope:** `use-autosave.ts` (circuit open + classifier), `general-application.service.ts` / `project-application.service.ts` (error codes), `GeneralApplicationPage.tsx` / project-app page (inline banner + Try-now + Reload), extend existing `e2e/regression/incidents/general-application-autosave.e2e.ts`.
**Goal:** After 3 consecutive 5xx OR any 4xx, circuit opens, ticker pauses, single `autosave_circuit_open` audit row (not per-tick storm), inline banner with actionable recovery.
**Use cases:** happy / single transient 5xx / sustained 5xx / 4xx schema / 401 / try-now success / try-now still-fail / reload / tab-hide silence / offline→online.
**BDD (AUTO-SAVE-001..010):** one scenario per use case; each asserts [Code] flush count, [DB] exactly N audit rows, [UI] correct banner copy and CTA set.

---

### Issue D — Postgres 42883 `digest(text, unknown)`

**Symptom:** Recurring `mutation.anonymous` rows with code 42883.
**Root cause:** `pgcrypto` moved to `extensions` schema (per SECURITY-HARDENING-PASS); any RPC calling bare `digest(text,'sha256')` fails from anon/authenticated sessions. Today's `clear_login_rate_limit_for_email` migration uses the same broken pattern.
**Fix:** Repoint all callsites to `extensions.digest(convert_to(<text>,'UTF8'),'sha256'::text)`; re-issue `clear_login_rate_limit_for_email`; extend `scripts/lint/sql-digest.mjs` to fail CI on bare `digest(`.
**Goal:** 0 occurrences of 42883.
**BDD (SQL-DIGEST-001..004):** RPC runs from edge fn; anon caller works; CI blocks unqualified digest; schema-qualified call returns bytea(32).

---

### Issue E — `email_domain_health.window_days` does not exist (42703)

**Symptom:** 4 `query.email-domain-health` failures/10d.
**Fix:** Add `window_days int` to the view OR drop from client select; add CI smoke that runs the exact client query.
**BDD (SYS-HEALTH-DRIFT-001..002):** tab loads; CI catches future drift.

---

### Issue F — `discord_username_not_found` retry storm

**Symptom:** 37 rows/7d; same handle retried 3× in 60s.
**Fix:** 5-min in-memory negative cache in `use-discord-username-repair.ts`, single audit row per unique miss, inline UI message after first miss with [Resend invite].
**Goal:** ≤5 rows/day platform-wide.
**BDD (DISCORD-LOOKUP-001..005):** first-miss writes one; repeat cached; different handle bypasses; success clears cache; reload invalidates.

---

### Issue G — `source:mutation.anonymous`

**Symptom:** 24 rows/14d with no actionable source.
**Fix:** New `scripts/lint/eslint-plugin-no-anonymous-mutation.mjs` requires `meta.audit` or `mutationKey`; reporter derives source from `mutationKey` when present; one-time label sweep.
**BDD (TRIAGE-LABEL-001..003):** ESLint blocks unlabeled; labeled surfaces `mutation.<name>`; mutationKey fallback works.

---

### Issue H — Bulk email lane saturating Resend (26 rate-limits/7d)

**Symptom:** 26 `email_rate_limited` last 7d, all bulk templates, all 18:00–22:00 UTC.
**Fix:** Add `bulk_send_delay_peak_ms` (default 900) + `bulk_peak_hours_utc` (default `[18,19,20,21]`) to `email_send_state`; `process-email-queue` uses peak delay in peak hours; if rolling 60-min success ≥ 80% of `bulk_hourly_cap`, double delay for 10 min; System Health "Bulk lane throttle" tile.
**Goal:** ≤5 bulk `email_rate_limited`/7d.
**BDD (EMAIL-PEAK-001..005):** peak applied; off-peak baseline; adaptive doubling; tile reflects state; config edit takes effect next batch.

---

### Issue I — Stuck-pending email tile

**Fix:** Render existing `get_stuck_pending_email_count(10)` as a card with 7-day sparkline in System Health → Email.
**BDD (EMAIL-STUCK-001..002):** zero state green; non-zero alert with link.

---

## §2. Out of scope

Resend quota (vendor), GoTrue server-side limits, HIBP toggle, new features, anything in §0.

---

## §3. Shipping order (single batch)

1. Migrations: schema-qualify `digest()` + re-issue `clear_login_rate_limit_for_email`; `email_domain_health.window_days`; `email_send_state` peak columns; **`trg_profiles_provision_customer` + `trg_user_roles_provision_admin` triggers + backfill seed of `support_provisioning_log`**.
2. New edge fn **`freescout-provision-customer`**; edit `_shared/freescout.ts` `createUser({sendInvite:false})`; extend `freescout-proxy` admin-write actions to call `requireAdminFreescoutUser`; extend `support-provisioning-retry` to cover `kind:customer`.
3. Edge fn: `process-email-queue` peak/adaptive (Issue H).
4. Client: `freescoutInvoke` + `audited-invoke` upstream-tag parity (Issue B).
5. Hook: `use-autosave` circuit (Issue C) + pages banners.
6. Hook: `use-discord-username-repair` cache + UI (Issue F).
7. Lint: `no-anonymous-mutation` + sweep (Issue G); extend `sql-digest.mjs` (Issue D).
8. System Health Email tab: bulk-throttle + stuck-pending tiles (H+I); Support tab: provisioning queue tiles (A).
9. CI smoke: `email_domain_health` shape (E).
10. BDD inserts: HELP-DESK-046..066 (21), AUTO-SAVE-001..010, SQL-DIGEST-001..004, SYS-HEALTH-DRIFT-001..002, DISCORD-LOOKUP-001..005, TRIAGE-LABEL-001..003, EMAIL-PEAK-001..005, EMAIL-STUCK-001..002 — 50 scenarios total.
11. Memory: append a single new entry summarizing this batch (esp. eager Freescout provisioning contract).

---

## §4. Definition of done (7d post-deploy)

- 0 `Profile_not_found`; 100% new signups provisioned ≤60s; 0 Freescout invite emails to admins (Issue A)
- 100% of `edge_invoke_failed` carry `upstream:*` (B)
- ≤5 `autosave.*` warns/user (C)
- 0 `42883 digest` (D)
- 0 `42703 email_domain_health.window_days` (E)
- ≤5 `discord_username_not_found`/day (F)
- 0 `source:mutation.anonymous` (G)
- ≤5 bulk `email_rate_limited`/7d (H)
- All 4 new System Health tiles visible; all 50 BDD scenarios passing.
