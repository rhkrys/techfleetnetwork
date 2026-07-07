# Baseline Restoration — PRD + BDD (v0.1 draft)

**Status:** DRAFT for Morgan's review (authored with Claude Code from a 5-agent + code-sweep audit)
**Goal:** Return the production platform to a working baseline **before** the Fleety re-architecture resumes.
**Theme:** Almost nothing here is a broken feature. It is a **migration that was never finished** on the new Supabase project (`pzvqxdgoztbfikfuifix`) — missing runtime secrets, missing RLS policies/grants that didn't reproduce from the old (Lovable-era, dashboard-configured) project, plus a few frontend "fail-silent" bugs that turn a backend gap into a confusing UX.

---

## 1. Root-cause classes (every finding maps to one)

- **A — Missing runtime secrets** on the new project (auth email, captcha, stats sync, push, integrations).
- **B — Missing/`anon`-less RLS policies** that didn't carry over (admin writes/reads; public/logged-out reads).
- **C — REVOKE-induced blocks** (verified: all intentional; writes flow via SECURITY DEFINER — do **not** re-grant).
- **D — `private`-schema grant** (already fixed by `20260625120000_restore_private_schema_grants.sql`; a timestamp collision to clean up).
- **E — Frontend fail-silent bugs** (no error state → looks broken / silent data loss).
- **F — Email plumbing** (Auth SMTP/webhook registration + provider secret).

## 2. In scope (fix in this release)

**D-1 — One RLS/grants migration** (new, unique timestamp, ordered last):
- `project_applications`: add admin `UPDATE` (+ `DELETE`) policy `USING has_role(...,'admin')` → unblocks admin status changes.
- `general_applications`: add admin `SELECT` policy → admins can review general applications.
- Public/logged-out reads: grant read access for `anon` on the tables the logged-out UI actually uses — **but fix at the correct layer** (see §6 note): if the read path is a SECURITY DEFINER RPC (e.g. `get_network_stats`), grant `EXECUTE` to `anon` on the RPC rather than blanket `anon` table SELECT. Candidate tables/paths: `network_stats_snapshots`, `network_stats_historical`, `network_stats_overrides`, `course_completion_stats`, `course_catalog`, `lesson_catalog`, `quest_paths`, `quest_path_steps`. Grant anon read **only** where the logged-out UI genuinely needs it.
- Verify `audit_log` has an admin `SELECT` path (for the activity-log/Gaps views).
- Does **not** re-grant `private` schema (already done) and does **not** re-grant `course_completions` writes (SECURITY DEFINER trigger is the intended path).

**D-2 — Secrets checklist** (Cowork; no code) — set/verify on `pzvqxdgoztbfikfuifix`:
- 🔴 `TURNSTILE_SECRET_KEY` (captcha → signup), auth email (see D-4), `AIRTABLE_PAT` / `AIRTABLE_BASE_ID` / `AIRTABLE_TABLE_NAME` / `NETWORK_STATS_CRON_SECRET` (dashboard stats).
- 🟡 `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` (push), `APP_ORIGIN` / `SITE_ORIGIN` (email links), `DISCORD_*` (mostly set ~Jul 1; confirm `/fleety`), `FREESCOUT_*`, `GUMROAD_*`, `AUTH_PROBER_*`, `INTERNAL_FN_SECRET`.
- 🟢 already set: `GEMINI_API_KEY`, `GROQ_API_KEY`, `CRON_SECRET`; auto-injected: `SUPABASE_URL/ANON_KEY/SERVICE_ROLE_KEY/PUBLISHABLE_KEY`.
- *(Complete inventory: every `Deno.env.get` across 117 functions — in the audit appendix.)*

**D-3 — Frontend error-state fixes** (turn silent failures into correct UX):
- `GenericCoursePage.toggleLesson` — add error handling + rollback; today a failed write silently reverts on refresh.
- Dashboard overview — render an error state instead of an **infinite skeleton** when the RPC fails.
- Events calendar — explicit "couldn't load events" state.
- Application autosave — surface failure instead of showing a false "Saved".

**D-4 — Email delivery** (choose path; see open decision):
- **Quick unblock:** set `LOVABLE_API_KEY` so `auth-email-hook` stops 500-ing → signup/reset emails send.
- **Proper end-state:** `EMAIL_PROVIDER=ses` + `SES_SMTP_HOST/USERNAME/PASSWORD/PORT` + `EMAIL_FROM_ADDRESS` (requires SES out of sandbox).
- **Either way:** verify Supabase Auth → SMTP/Email-hook **registration in the dashboard** (the hook only fires if registered).

**D-5 — Migration hygiene:** resolve the duplicate `20260625120000` version (my Fleety migration collides with `restore_private_schema_grants`); drop the duplicated private-grant block from the Fleety migration; the baseline migration gets a fresh unique timestamp.

## 3. Out of scope
- Fleety re-architecture (separate; resumes after this baseline is QA'd).
- Any feature rewrite. Auth flows are frozen; we only add missing policies/secrets, we do not change auth logic.

## 4. Findings inventory (condensed; file:line)

| Class | Finding | Where | Impact |
|---|---|---|---|
| B | `project_applications` no admin UPDATE/DELETE | 20260318004034:33-48 | admins can't change applicant status |
| B | `general_applications` no admin SELECT | 20260317034754:22-47 | admins can't see general apps |
| B | `network_stats_*`, `course_catalog`, `lesson_catalog`, `quest_paths/steps` no anon read | 20260520035523:241-256; 20260412203713 | logged-out stats/catalog blank |
| A | `LOVABLE_API_KEY` unset | auth-email-hook | signup/reset emails 500 silently |
| A | `TURNSTILE_SECRET_KEY` unset | login-with-captcha | signup blocked (503) |
| A | `AIRTABLE_*` unset | sync-airtable-network-stats | stats never refresh |
| E | course toggle no error handling | GenericCoursePage.tsx | silent revert on refresh |
| E | dashboard overview no error state | DashboardPage.tsx | infinite skeleton |
| E | events no error state | EventsPage.tsx | silent empty calendar |
| C | `course_completions` writes revoked | 20260520045034:160 | by design (trigger path) — verify only |
| D | `private` grant fix + timestamp collision | 20260625120000_* (two files) | dedupe/rename |

**What's working (do not touch):** project *status* updates (`projects` RLS OK; 6 recent `projects_update`), course completions (587 `task_completed` via trigger), events RLS, profiles/user_roles.

## 5. BDD scenarios (acceptance)

**BDD-1 — Member submits a project application (client & volunteer)**
- Given an authenticated member with a completed general application
- When they complete and submit a project application
- Then a row is inserted into `project_applications` with `status='completed'`
- And the confirmation email is queued (email path healthy)
- And the member sees a success state (not a silent failure).

**BDD-2 — Admin changes an applicant's status**
- Given an admin viewing an applicant in the recruiting center
- When they set the applicant status (e.g., invited → accepted)
- Then the `project_applications` row updates (admin UPDATE policy permits it)
- And the UI reflects the new status without a 403.

**BDD-3 — Admin changes a project's status (regression guard)**
- Given an admin on a project
- When they change `project_status`
- Then the `projects` row updates and persists (already working; must not regress).

**BDD-4 — Admin reviews general applications**
- Given an admin opens the applications view
- When the list loads
- Then general applications are returned (admin SELECT policy permits it) — not an empty "no applications."

**BDD-5 — Member marks a module complete**
- Given a member on a course module
- When they mark it complete
- Then `journey_progress` is written and the completion persists across refresh
- And if the write fails, an error is shown and the checkbox rolls back (no false "complete").

**BDD-6 — Events calendar shows events**
- Given any user opens the events page
- When `get-community-events` returns events
- Then the calendar renders them; if it fails, a "couldn't load events" state shows (not a silent empty grid).

**BDD-7 — Logged-in dashboard renders stats**
- Given an authenticated user opens the dashboard
- When the overview RPC succeeds, stats render
- And when it fails, an error state shows (not an infinite skeleton).

**BDD-8 — Logged-out landing shows network stats**
- Given a logged-out visitor on the landing page
- When network stats load (via the anon-permitted read path)
- Then the community stats render (not blank).

**BDD-9 — New user signs up and receives confirmation**
- Given a visitor completes the signup form
- When they pass the Turnstile captcha (secret set) and submit
- Then the account is created and a confirmation email is delivered
- And clicking the link confirms the account.

**BDD-10 — Password reset delivers and completes**
- Given a user requests a password reset
- When the request is submitted
- Then a reset email is delivered
- And the reset link lets them set a new password.

**BDD-11 — Secret-dependent functions don't fail closed**
- Given the required secrets are set
- When `login-with-captcha` / `auth-email-hook` / `sync-airtable-network-stats` run
- Then none return a 500/503 due to a missing secret.

## 6. Notes / how we'll fix safely
- **Fix at the right layer:** for logged-out stats, confirm whether the read path is a direct table SELECT or a SECURITY DEFINER RPC (`get_network_stats`). If RPC, grant `EXECUTE TO anon` on the RPC rather than opening table-level anon SELECT — narrower and correct.
- **No auth weakening:** we only *add* the admin/anon policies that the app already assumes; RLS still enforces per-row access. Every added policy uses `public.has_role(...,'admin')` or `USING (true)` only on genuinely-public data.
- **Proof:** each RLS fix ships with a pgTAP/RLS test (admin can, non-admin cannot; anon can read public, cannot read private). Frontend fixes ship with a test that a failed write surfaces an error.

## 7. Release plan
1. Land D-1 (migration) + D-5 (hygiene) + D-3 (frontend) on a `baseline-restoration` branch → PR → CI green.
2. Cowork applies D-2 (secrets) + D-4 (email/Auth-SMTP) on the project.
3. Deploy; run the BDD scenarios against production; watch the activity log for 24h.
4. Then resume Fleety re-architecture.

## 8. Open items
- **Drill-down queries** (client_error, edge_invoke_failed, `project_applications` rows/day) — to confirm whether submit truly fails or only its confirmation email, and what the 231 client-errors / 33 edge-failures are.
- **Email path decision:** `LOVABLE_API_KEY` now vs straight to SES.
- **Which "status"** you meant in "admins can't change status of projects" — project status (works) vs applicant status (blocked). BDD-2/BDD-3 cover both.
</content>
